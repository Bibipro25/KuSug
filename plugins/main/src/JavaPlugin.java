import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import com.mojang.minecraftpe.core.JavaPluginEntry;
import com.mojang.minecraftpe.core.JavaCallResult;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Closeable;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.atomic.AtomicLong;

public class JavaPlugin implements JavaPluginEntry {

	private static final String BASE_URL = "https://kusug.bibi.skin/";
	private static final String UPDATE_CONFIG_URL = BASE_URL + "update.json";
	private static final String LIST_ADD_URL = BASE_URL + "api/list.php?type=add";
	private static final String LIST_REMOVE_URL = BASE_URL + "api/list.php?type=remove";
	private static final String LIST_HASHES_URL = BASE_URL + "api/hashes.php";
	private static String resRoot = null;

	private static String localConfigFile() {
		return resRoot + "/KuSug.json";
	}

	private static final int PROGRESS_POST_MS = 100;
	private static final int DOWNLOAD_THREADS = 4;

	private static final int COLOR_PRIMARY = 0xFF6366F1;
	private static final int COLOR_SURFACE = 0xFFFFFFFF;
	private static final int COLOR_CARD_BG = 0xFFF8FAFC;
	private static final int COLOR_ON_SURFACE = 0xFF0F172A;
	private static final int COLOR_ON_SURFACE_VARIANT = 0xFF64748B;
	private static final int COLOR_BTN_CANCEL_BG = 0xFFEEF2F6;
	private static final int COLOR_SUCCESS = 0xFF16A34A;
	private static final int COLOR_ERROR = 0xFFDC2626;
	private static int screenW = 0;
	private static int screenH = 0;

	private static Activity mainActivity;
	private static Context appCtx;
	private static ViewGroup rootView;
	private static Handler handler = new Handler(Looper.getMainLooper());
	private static final ExecutorService LOG_EXECUTOR = Executors.newSingleThreadExecutor();

	private static boolean updateChecking = false;
	private static boolean updateApplying = false;
	private static String pendingVersion = "";
	private static String pendingLog = "发现新版本，是否更新？";
	private static boolean pendingBeta = false;
	private static boolean pendingRestart = true;

	private static AlertDialog updateDialog;
	private static TextView updateTitle;
	private static View updateInfoCard;
	private static TextView progressText;
	private static TextView logView;
	private static ScrollView logScroll;
	private static LinearLayout updateBtnRow;
	private static TextView updateBtnCancel;
	private static TextView updateBtnOk;
	private static volatile int progressTotal = 0;
	private static volatile int progressDone = 0;
	private static final AtomicLong progressBytesDone = new AtomicLong();
	private static final AtomicLong progressBytesTotal = new AtomicLong();
	private static volatile long lastProgressPostMs = 0;
	private static final List applyErrors = Collections.synchronizedList(new ArrayList());

	@Override
	public void init(Activity activity, Context ctx, JavaCallResult callResult) {
		try {
			if (mainActivity != null) {
				// Activity 重建时先释放旧界面、旧动画与旧监听器，防止多套并存
				release();
			}
			mainActivity = activity;
			appCtx = ctx.getApplicationContext();

			readRootCandidates();

			View decor = activity.getWindow().getDecorView();
			if (decor instanceof ViewGroup) {
				rootView = (ViewGroup) decor;
			} else {
				rootView = (ViewGroup) activity.findViewById(android.R.id.content);
			}

			WindowManager wm = (WindowManager) activity.getSystemService(Context.WINDOW_SERVICE);
			if (wm != null) {
				DisplayMetrics dm = new DisplayMetrics();
				wm.getDefaultDisplay().getRealMetrics(dm);
				screenW = dm.widthPixels;
				screenH = dm.heightPixels;
			}

			startUpdateCheck();
		} catch (Exception e) {
			Toast.makeText(activity, "KuSug初始化失败: " + e.getMessage(), Toast.LENGTH_LONG).show();
		}
	}

	private static void readRootCandidates() {
		resRoot = "/storage/emulated/0/Android/data/" + mainActivity.getPackageName() + "/files/resources";
		File kf = new File(resRoot, "KuSug.json");
		if (!kf.exists()) {
			File parent = kf.getParentFile();
			if (parent != null && !parent.exists()) parent.mkdirs();
			FileOutputStream out = null;
			String createErr = null;
			try {
				out = new FileOutputStream(kf);
				out.write("{\"version\":\"\"}".getBytes("UTF-8"));
				out.flush();
				out.close();
				out = null;
			} catch (Exception e) {
				createErr = e.getMessage();
			}
			closeQuietly(out);
			if (createErr != null) {
				final String msg = createErr;
				if (mainActivity != null) {
					mainActivity.runOnUiThread(new Runnable() {
						@Override public void run() {
							Toast.makeText(mainActivity, "KuSug.json 创建失败: " + msg, Toast.LENGTH_LONG).show();
						}
					});
				}
			}
		}
	}

	// 统一释放：停止动画/轮询/文件监听，解除旧 Activity 与视图的静态引用
	public static void release() {
		dismissUpdateDialog();

		rootView = null;
		mainActivity = null;
	}

	private static void startUpdateCheck() {
		if (updateChecking || appCtx == null) return;
		updateChecking = true;
		new Thread(new UpdateCheckTask()).start();
	}

	private static void ulog(String msg) {
		if (resRoot == null) return;
		final String text = "[" + System.currentTimeMillis() + "] " + msg + "\n";
		final String root = resRoot;
		try {
			LOG_EXECUTOR.execute(new Runnable() {
				@Override public void run() {
					try {
						File dir = new File(root + "/kusug");
						if (!dir.exists()) dir.mkdirs();
						File f = new File(dir, "update.log");
						FileOutputStream out = new FileOutputStream(f, true);
						out.write(text.getBytes("UTF-8"));
						out.flush();
						out.close();
					} catch (Throwable t) {
					}
				}
			});
		} catch (Throwable t) {
		}
	}

	private static void ulogSelfTest() {
		File f = new File(resRoot + "/kusug/update.log");
		ulog("ulog self-test: file=" + f.getAbsolutePath()
			+ " exists=" + f.exists() + " len=" + (f.exists() ? f.length() : -1)
			+ " resRoot=" + resRoot);
	}

	private static class UpdateCheckTask implements Runnable {
		@Override public void run() {
			boolean showDialog = false;
			boolean autoUpdate = false;
			ulogSelfTest();
			ulog("update check start");
			try {
				String json = httpGet(UPDATE_CONFIG_URL + "?t=" + System.currentTimeMillis(), 10000);
				JSONObject cfg = new JSONObject(json);
				String remote = cfg.optString("version", "");
				String local = loadLocalVersion();
				String localCode = loadLocalVersionCode();
				String remoteCode = cfg.optString("version_code", "").trim();
				ulog("check remote=" + remote + " local=" + local + " remoteCode=" + remoteCode + " localCode=" + localCode);
				if (remote.length() > 0 && !remote.equals(local)
						&& remoteCode.length() > 0 && remoteCode.equals(localCode)) {
					pendingVersion = remote;
					pendingLog = cfg.optString("log", "发现新版本，是否更新？");
					pendingBeta = cfg.optBoolean("beta", false);
					pendingRestart = cfg.optBoolean("restart", true);
					ulog("restart required: " + pendingRestart);
					if (cfg.optBoolean("force", false)) {
						autoUpdate = true;
						ulog("decision: force auto update to " + remote);
					} else {
						showDialog = true;
						ulog("decision: show update dialog to " + remote);
					}
				} else {
					ulog("decision: no update (up-to-date or code mismatch)");
				}
			} catch (Exception e) {
				ulog("check exception: " + e.getMessage());
			}
			if (autoUpdate && mainActivity != null) {
				mainActivity.runOnUiThread(startApplyUiTask);
			} else if (showDialog && mainActivity != null) {
				mainActivity.runOnUiThread(showDialogTask);
			}
			updateChecking = false;
		}
	}

	private static Runnable showDialogTask = new Runnable() {
		@Override public void run() {
			if (!isActivityAlive()) return;
			showUpdateDialog();
		}
	};

	private static Runnable startApplyUiTask = new Runnable() {
		@Override public void run() {
			if (!isActivityAlive()) return;
			startApplyUpdate();
		}
	};

	private static boolean isActivityAlive() {
		if (mainActivity == null) return false;
		try {
			if (mainActivity.isFinishing()) return false;
			if (mainActivity.isDestroyed()) return false;
		} catch (Exception ignore) {}
		return true;
	}

	private static GradientDrawable makeBg(int color, float radius) {
		GradientDrawable gd = new GradientDrawable();
		gd.setColor(color);
		gd.setCornerRadius(radius);
		return gd;
	}

	private static float dpF(float dp) {
		float d = mainActivity != null ? mainActivity.getResources().getDisplayMetrics().density : 1f;
		return dp * d;
	}

	// 向更新弹窗的日志区追加一行（后台线程安全，自动滚动到底部）
	private static void appendLog(final String line) {
		if (mainActivity == null) return;
		mainActivity.runOnUiThread(new Runnable() {
			@Override public void run() {
				try {
					if (logView == null) return;
					logView.append(line + "\n");
					if (logScroll != null) logScroll.fullScroll(View.FOCUS_DOWN);
				} catch (Throwable ignore) {}
			}
		});
	}

	private static synchronized void updateProgress(final int done, final int total, final int fail) {
		if (mainActivity == null) return;
		long now = System.currentTimeMillis();
		boolean isLast = total > 0 && done >= total;
		boolean forcePost = isLast || now - lastProgressPostMs >= PROGRESS_POST_MS;
		if (!forcePost) return;
		lastProgressPostMs = now;
		final long bytesDone = progressBytesDone.get();
		final long bytesTotal = progressBytesTotal.get();
		mainActivity.runOnUiThread(new Runnable() {
			@Override public void run() {
				try {
					if (progressText != null) {
						String s = done + "/" + total;
						if (bytesTotal > 0) {
							s = s + "  " + formatBytes(bytesDone) + "/" + formatBytes(bytesTotal);
						} else if (bytesDone > 0) {
							s = s + "  已下载 " + formatBytes(bytesDone);
						}
						if (fail > 0) s = s + "（失败 " + fail + "）";
						progressText.setText(s);
					}
				} catch (Exception ignore) {}
			}
		});
	}

	private static String formatBytes(long bytes) {
		if (bytes < 1024) return bytes + " B";
		if (bytes < 1024 * 1024) return String.format(java.util.Locale.US, "%.1f KB", bytes / 1024.0);
		return String.format(java.util.Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0));
	}


	// 关闭并清理更新弹窗（主线程调用）
	private static void dismissUpdateDialog() {
		if (updateDialog != null) {
			try {
				updateDialog.dismiss();
			} catch (Throwable ignore) {}
		}
		updateDialog = null;
		updateTitle = null;
		updateInfoCard = null;
		progressText = null;
		logView = null;
		logScroll = null;
		updateBtnRow = null;
		updateBtnCancel = null;
		updateBtnOk = null;
	}

	private static void showUpdateDialog() {
		final Activity act = mainActivity;
		try {
			LinearLayout main = new LinearLayout(act);
			main.setOrientation(LinearLayout.VERTICAL);
			main.setPadding(dpI(16), dpI(14), dpI(16), dpI(12));
			main.setBackgroundDrawable(makeBg(COLOR_SURFACE, dpF(16f)));

			updateTitle = new TextView(act);
			String titleText = "KuSug 更新";
			if (pendingBeta) titleText = titleText + "（测试版）";
			updateTitle.setText(titleText);
			updateTitle.setTextSize(16);
			updateTitle.setTypeface(null, Typeface.BOLD);
			updateTitle.setTextColor(COLOR_ON_SURFACE);
			main.addView(updateTitle);

			// 信息卡：检测到新版本（开始更新后隐藏，让位给日志输出）
			LinearLayout card = new LinearLayout(act);
			card.setOrientation(LinearLayout.VERTICAL);
			card.setPadding(dpI(14), dpI(10), dpI(14), dpI(10));
			card.setBackgroundDrawable(makeBg(COLOR_CARD_BG, dpF(14f)));
			LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(
				ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
			cardLp.topMargin = dpI(10);
			updateInfoCard = card;

			TextView detected = new TextView(act);
			detected.setText("检测到新版本");
			detected.setTextSize(14);
			detected.setTypeface(null, Typeface.BOLD);
			detected.setTextColor(COLOR_PRIMARY);
			card.addView(detected);

			String localVer = loadLocalVersion();
			if (localVer.length() == 0) localVer = "无";
			TextView version = new TextView(act);
			version.setText("当前版本 " + localVer + " → 最新版本 " + pendingVersion);
			version.setTextSize(13);
			version.setTextColor(COLOR_ON_SURFACE_VARIANT);
			version.setPadding(0, dpI(6), 0, 0);
			card.addView(version);

			TextView notice = new TextView(act);
			notice.setText(pendingLog);
			notice.setTextSize(14);
			notice.setTextColor(COLOR_ON_SURFACE);
			notice.setLineSpacing(4f, 1f);
			notice.setPadding(0, dpI(10), 0, 0);
			final ScrollView noticeScroll = new ScrollView(act);
			noticeScroll.addView(notice, new FrameLayout.LayoutParams(
				ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
			card.addView(noticeScroll);
			main.addView(card, cardLp);
			int noticeCap = screenH > 0 ? (int) (screenH * 0.3) : dpI(200);
			if (noticeCap < dpI(120)) noticeCap = dpI(120);
			if (noticeCap > dpI(280)) noticeCap = dpI(280);
			final int noticeMaxH = noticeCap;

			TextView tips = new TextView(act);
			tips.setText(pendingRestart ? "本次更新需要重启游戏后生效。" : "本次更新完成后立即生效，无需重启游戏。");
			tips.setTextSize(12);
			tips.setTextColor(COLOR_ON_SURFACE_VARIANT);
			tips.setPadding(0, dpI(12), 0, 0);
			main.addView(tips);

			// 进度行与日志区（开始更新后显示）
			progressText = new TextView(act);
			progressText.setText("准备中…");
			progressText.setTextSize(12);
			progressText.setTypeface(null, Typeface.BOLD);
			progressText.setTextColor(COLOR_PRIMARY);
			progressText.setPadding(0, dpI(8), 0, 0);
			progressText.setVisibility(View.GONE);
			main.addView(progressText);

			logView = new TextView(act);
			logView.setTextSize(11);
			logView.setTextColor(COLOR_ON_SURFACE);
			logView.setLineSpacing(2f, 1f);
			logView.setPadding(dpI(10), dpI(8), dpI(10), dpI(8));
			logView.setBackgroundDrawable(makeBg(COLOR_CARD_BG, dpF(10f)));

			logScroll = new ScrollView(act);
			logScroll.addView(logView, new FrameLayout.LayoutParams(
				ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
			int logH = screenH > 0 ? (int) (screenH * 0.38) : dpI(260);
			if (logH < dpI(160)) logH = dpI(160);
			if (logH > dpI(380)) logH = dpI(380);
			LinearLayout.LayoutParams logLp = new LinearLayout.LayoutParams(
				ViewGroup.LayoutParams.MATCH_PARENT, logH);
			logLp.topMargin = dpI(10);
			logScroll.setVisibility(View.GONE);
			main.addView(logScroll, logLp);

			// 底部按钮：确认 / 结果 两态复用
			updateBtnRow = new LinearLayout(act);
			updateBtnRow.setOrientation(LinearLayout.HORIZONTAL);
			updateBtnRow.setGravity(Gravity.CENTER);
			updateBtnRow.setPadding(0, dpI(10), 0, 0);

			updateBtnCancel = new TextView(act);
			updateBtnCancel.setText("以后再说");
			updateBtnCancel.setTextSize(13);
			updateBtnCancel.setGravity(Gravity.CENTER);
			updateBtnCancel.setTypeface(null, Typeface.BOLD);
			updateBtnCancel.setTextColor(COLOR_ON_SURFACE_VARIANT);
			updateBtnCancel.setPadding(0, dpI(8), 0, dpI(8));
			updateBtnCancel.setBackgroundDrawable(makeBg(COLOR_BTN_CANCEL_BG, dpF(12f)));
			updateBtnCancel.setOnClickListener(new View.OnClickListener() {
				@Override public void onClick(View v) {
					dismissUpdateDialog();
				}
			});

			updateBtnOk = new TextView(act);
			updateBtnOk.setText("立即更新");
			updateBtnOk.setTextSize(13);
			updateBtnOk.setGravity(Gravity.CENTER);
			updateBtnOk.setTypeface(null, Typeface.BOLD);
			updateBtnOk.setTextColor(0xFFFFFFFF);
			updateBtnOk.setPadding(0, dpI(8), 0, dpI(8));
			updateBtnOk.setBackgroundDrawable(makeBg(COLOR_PRIMARY, dpF(12f)));
			updateBtnOk.setOnClickListener(new View.OnClickListener() {
				@Override public void onClick(View v) {
					startApplyUpdate();
				}
			});

			updateBtnRow.addView(updateBtnCancel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
			View spacer = new View(act);
			updateBtnRow.addView(spacer, new LinearLayout.LayoutParams(dpI(12), 1));
			updateBtnRow.addView(updateBtnOk, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
			main.addView(updateBtnRow);

			updateDialog = new AlertDialog.Builder(act).setView(main).create();
			updateDialog.setCancelable(false);
			updateDialog.setCanceledOnTouchOutside(false);
			updateDialog.show();
			if (updateDialog.getWindow() != null) {
				updateDialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
				int maxW = screenW > 0 ? (int) (screenW * 0.5) : dpI(340);
				if (maxW > dpI(440)) maxW = dpI(440);
				if (maxW < dpI(280)) maxW = dpI(280);
				updateDialog.getWindow().setLayout(maxW, ViewGroup.LayoutParams.WRAP_CONTENT);
				updateDialog.getWindow().getDecorView().post(new Runnable() {
					@Override public void run() {
						if (noticeScroll.getHeight() > noticeMaxH) {
							ViewGroup.LayoutParams lp = noticeScroll.getLayoutParams();
							lp.height = noticeMaxH;
							noticeScroll.setLayoutParams(lp);
						}
					}
				});
			}
		} catch (Exception e) {
			Toast.makeText(act, "更新弹窗失败: " + e.getMessage(), Toast.LENGTH_LONG).show();
			dismissUpdateDialog();
		}
	}

	// 点击「立即更新」后：同一弹窗切换为更新模式，信息卡让位给日志输出
	private static void switchToUpdatingDialog() {
		if (updateDialog == null) return;
		try {
			updateTitle.setText("正在更新到 " + pendingVersion);
			updateTitle.setTextColor(COLOR_PRIMARY);
			if (updateInfoCard != null) updateInfoCard.setVisibility(View.GONE);
			if (progressText != null) progressText.setVisibility(View.VISIBLE);
			if (logScroll != null) logScroll.setVisibility(View.VISIBLE);
			if (updateBtnRow != null) updateBtnRow.setVisibility(View.GONE);
		} catch (Throwable ignore) {}
	}

	// 更新结束：同一弹窗切换为结果模式，标题与按钮随成败变化
	private static void switchToResultDialog(final int fail) {
		if (updateDialog == null) return;
		try {
			if (fail == 0) {
				updateTitle.setText("更新完成");
				updateTitle.setTextColor(COLOR_SUCCESS);
				if (pendingRestart) {
					updateBtnCancel.setVisibility(View.VISIBLE);
					updateBtnCancel.setText("稍后重启");
					updateBtnCancel.setOnClickListener(new View.OnClickListener() {
						@Override public void onClick(View v) {
							dismissUpdateDialog();
						}
					});
					updateBtnOk.setText("立即重启");
					updateBtnOk.setOnClickListener(new View.OnClickListener() {
						@Override public void onClick(View v) {
							dismissUpdateDialog();
							new Thread(new Runnable() {
								@Override public void run() {
									try { Thread.sleep(500); } catch (Exception ignore) {}
									android.os.Process.killProcess(android.os.Process.myPid());
									System.exit(0);
								}
							}).start();
						}
					});
				} else {
					updateBtnCancel.setVisibility(View.GONE);
					updateBtnOk.setText("完成");
					updateBtnOk.setOnClickListener(new View.OnClickListener() {
						@Override public void onClick(View v) {
							dismissUpdateDialog();
						}
					});
				}
			} else {
				updateTitle.setText("更新未完成");
				updateTitle.setTextColor(COLOR_ERROR);
				updateBtnCancel.setVisibility(View.GONE);
				updateBtnOk.setText("复制信息并关闭");
				updateBtnOk.setOnClickListener(new View.OnClickListener() {
					@Override public void onClick(View v) {
						try {
							ClipboardManager cm = (ClipboardManager) mainActivity.getSystemService(Context.CLIPBOARD_SERVICE);
							if (cm != null && logView != null) {
								cm.setPrimaryClip(ClipData.newPlainText("KuSug更新失败", logView.getText().toString()));
							}
						} catch (Throwable ignore) {}
						dismissUpdateDialog();
					}
				});
			}
			if (updateBtnRow != null) updateBtnRow.setVisibility(View.VISIBLE);
		} catch (Throwable ignore) {}
	}

	private static void startApplyUpdate() {
		if (updateApplying) return;
		updateApplying = true;
		progressDone = 0;
		progressTotal = 0;
		progressBytesDone.set(0);
		progressBytesTotal.set(0);
		lastProgressPostMs = 0;
		applyErrors.clear();
		ulog("apply start, target=" + pendingVersion);
		if (mainActivity != null) {
			mainActivity.runOnUiThread(new Runnable() {
				@Override public void run() {
					switchToUpdatingDialog();
				}
			});
		}
		new Thread(new ApplyUpdateTask()).start();
	}

	private static class ApplyUpdateTask implements Runnable {
		@Override public void run() {
			int ok = 0;
			int fail = 0;
			int skip = 0;
			ArrayList removeList;
			ArrayList addList = null;
			ArrayList hashList = null;
			appendLog("开始更新，目标版本 " + pendingVersion);
			try {
				appendLog("获取更新清单…");
				removeList = parseFileList(httpGet(LIST_REMOVE_URL + "&t=" + System.currentTimeMillis(), 15000));
				try {
					hashList = parseHashList(httpGet(LIST_HASHES_URL + "?t=" + System.currentTimeMillis(), 15000));
				} catch (Exception he) {
					hashList = null;
					ulog("hashes fetch failed, fallback full: " + he.getMessage());
					appendLog("哈希清单不可用（" + he.getMessage() + "），回退全量下载");
				}
				if (hashList == null) {
					addList = parseFileList(httpGet(LIST_ADD_URL + "&t=" + System.currentTimeMillis(), 15000));
				}
			} catch (Exception e) {
				ulog("fetch list exception: " + e.getMessage());
				applyErrors.add("获取更新清单失败: " + e.getMessage());
				appendLog("获取更新清单失败: " + e.getMessage());
				finishApply(0, 1);
				return;
			}
			int addCount = hashList != null ? hashList.size() : addList.size();
			ulog("lists remove=" + removeList.size() + " add=" + addCount + (hashList != null ? " (hash)" : " (full)"));
			appendLog("清单: 删除 " + removeList.size() + " 项，新增/校验 " + addCount + " 项");
			progressTotal = removeList.size() + addCount;
			progressDone = 0;
			progressBytesTotal.set(0);
			updateProgress(0, progressTotal, 0);
			for (int i = 0; i < removeList.size(); i++) {
				String rel = extractRel((String) removeList.get(i), "remove");
				boolean success = true;
				if (rel != null) {
					success = deleteTarget(new File(resRoot, rel));
				}
				if (success) {
					appendLog("删除 ✓ " + rel);
				} else {
					ulog("remove fail: " + rel);
					applyErrors.add("删除失败: " + rel);
					appendLog("删除 ✗ " + rel);
				}
				if (success) ok++; else fail++;
				progressDone++;
				updateProgress(progressDone, progressTotal, fail);
			}
			if (addCount > 0) {
				ExecutorService pool = Executors.newFixedThreadPool(DOWNLOAD_THREADS);
				CompletionService results = new ExecutorCompletionService(pool);
				boolean poolError = false;
				int submitted = 0;
				int received = 0;
				try {
					ArrayList downloadTasks = new ArrayList();
					long expectedBytes = 0;
					if (hashList != null) {
						for (int i = 0; i < hashList.size(); i++) {
							HashEntry e = (HashEntry) hashList.get(i);
							File dest = new File(resRoot, e.rel);
							String why = needDownload(dest, e);
							if (why == null) {
								skip++;
								appendLog("跳过 ✓ " + e.rel + "（未变更）");
								progressDone++;
								updateProgress(progressDone, progressTotal, fail);
								continue;
							}
							DownloadTask task = new DownloadTask(BASE_URL + "add/" + e.rel, e.rel, dest, e.md5, why, e.size);
							downloadTasks.add(task);
							if (e.size > 0) expectedBytes += e.size;
						}
						progressBytesTotal.set(expectedBytes);
					} else {
						for (int i = 0; i < addList.size(); i++) {
							String rel = extractRel((String) addList.get(i), "add");
							if (rel != null) {
								downloadTasks.add(new DownloadTask(BASE_URL + "add/" + rel, rel, new File(resRoot, rel), null, null, -1));
							}
						}
					}
					for (int i = 0; i < downloadTasks.size(); i++) {
						results.submit((Callable) downloadTasks.get(i));
						submitted++;
					}
					updateProgress(progressDone, progressTotal, fail);
					for (int i = 0; i < submitted; i++) {
						Future result = results.take();
						received++;
						try {
							Object r = result.get();
							if (r instanceof Boolean && ((Boolean) r).booleanValue()) ok++; else fail++;
						} catch (Exception e) {
							fail++;
						}
						progressDone++;
						updateProgress(progressDone, progressTotal, fail);
					}
				} catch (Exception e) {
					poolError = true;
					int unfinished = submitted - received;
					if (unfinished > 0) {
						fail += unfinished;
						progressDone += unfinished;
					}
					ulog("download pool exception: " + e.getMessage());
					appendLog("下载线程池异常: " + e.getMessage());
					updateProgress(progressDone, progressTotal, fail);
				} finally {
					if (poolError) {
						pool.shutdownNow();
					} else {
						pool.shutdown();
					}
				}
			}
			ulog("apply done ok=" + ok + " skip=" + skip + " fail=" + fail);
			appendLog("更新结束: 成功 " + ok + " 项，跳过 " + skip + " 项，失败 " + fail + " 项");
			finishApply(ok, fail);
		}
	}

	private static void finishApply(int ok, int fail) {
		if (fail == 0) {
			ulog("all success, saveLocalVersion(" + pendingVersion + ")");
			appendLog("全部成功，正在写回版本号…");
			saveLocalVersion(pendingVersion);
			appendLog("版本号已写入: " + pendingVersion);
			appendLog(pendingRestart ? "更新完成，重启游戏后生效" : "更新完成，本次更新已生效");
		} else {
			ulog("has fail=" + fail + ", skip saveLocalVersion");
			appendLog("有 " + fail + " 项失败，版本号不写回，下次启动将自动重试");
		}
		final int finalFail = fail;
		if (mainActivity != null) {
			mainActivity.runOnUiThread(new Runnable() {
				@Override public void run() {
					if (!isActivityAlive()) return;
					switchToResultDialog(finalFail);
				}
			});
		}
		updateApplying = false;
	}

	private static class DownloadTask implements Callable {
		private final String url;
		private final String rel;
		private final File dest;
		private final String expectMd5;
		private final String reason;
		private final long expectedSize;

		DownloadTask(String url, String rel, File dest, String expectMd5, String reason, long expectedSize) {
			this.url = url;
			this.rel = rel;
			this.dest = dest;
			this.expectMd5 = expectMd5;
			this.reason = reason;
			this.expectedSize = expectedSize;
		}

		@Override public Boolean call() {
			String err = downloadTo(url, dest, expectMd5, expectedSize);
			if (err == null) {
				appendLog("下载 ✓ " + rel + (reason != null ? "（" + reason + "）" : ""));
				return Boolean.TRUE;
			}
			ulog("add fail: " + rel + " url=" + url + " err=" + err);
			applyErrors.add("下载失败: " + rel + "（" + err + "）");
			appendLog("下载 ✗ " + rel + " — " + err);
			return Boolean.FALSE;
		}
	}

	private static class HashEntry {
		final String rel;
		final long size;
		final String md5;

		HashEntry(String rel, long size, String md5) {
			this.rel = rel;
			this.size = size;
			this.md5 = md5;
		}
	}

	private static ArrayList parseHashList(String body) throws Exception {
		ArrayList out = new ArrayList();
		JSONArray arr = new JSONArray(body.trim());
		for (int i = 0; i < arr.length(); i++) {
			JSONObject o = arr.getJSONObject(i);
			String rel = extractRel(o.optString("file", "").trim(), "add");
			String md5 = o.optString("md5", "").trim();
			long size = o.optLong("size", -1);
			if (rel == null || rel.length() == 0 || md5.length() == 0) continue;
			out.add(new HashEntry(rel, size, md5));
		}
		return out;
	}

	// 返回 null 表示本地与云端一致可跳过, 否则返回需要下载的原因
	private static String needDownload(File dest, HashEntry e) {
		if (!dest.exists()) return "本地缺失";
		if (e.size >= 0 && dest.length() != e.size) return "大小不同";
		String local = md5OfFile(dest);
		if (local.length() == 0) return "读取失败";
		if (!local.equalsIgnoreCase(e.md5)) return "内容不同";
		return null;
	}

	private static String md5OfFile(File f) {
		FileInputStream in = null;
		try {
			MessageDigest md = MessageDigest.getInstance("MD5");
			in = new FileInputStream(f);
			byte[] buf = new byte[8192];
			int n;
			while ((n = in.read(buf)) > 0) {
				md.update(buf, 0, n);
			}
			byte[] dg = md.digest();
			StringBuilder sb = new StringBuilder();
			for (int i = 0; i < dg.length; i++) {
				String h = Integer.toHexString(dg[i] & 0xFF);
				if (h.length() < 2) sb.append('0');
				sb.append(h);
			}
			return sb.toString();
		} catch (Exception e) {
			return "";
		} finally {
			closeQuietly(in);
		}
	}

	private static ArrayList parseFileList(String body) {
		ArrayList out = new ArrayList();
		if (body == null) return out;
		String b = body.trim();
		if (b.length() == 0) return out;
		if (b.startsWith("[")) {
			try {
				JSONArray arr = new JSONArray(b);
				for (int i = 0; i < arr.length(); i++) {
					String s = arr.optString(i, "").trim();
					if (s.length() > 0) out.add(s);
				}
				return out;
			} catch (Exception e) {
			}
		}
		String[] lines = b.split("\n");
		for (int i = 0; i < lines.length; i++) {
			String s = lines[i].trim();
			if (s.length() > 0) out.add(s);
		}
		return out;
	}

	private static String extractRel(String entry, String op) {
		if (entry == null) return null;
		String e = entry.trim();
		String marker = "/" + op + "/";
		int idx = e.indexOf(marker);
		if (idx >= 0) {
			return e.substring(idx + marker.length());
		}
		if (e.startsWith(op + "/")) {
			return e.substring(op.length() + 1);
		}
		if (e.length() > 0) {
			return e;
		}
		return null;
	}

	private static boolean deleteTarget(File f) {
		try {
			if (!f.exists()) return true;
			boolean ok = true;
			if (f.isDirectory()) {
				File[] children = f.listFiles();
				if (children != null) {
					for (int i = 0; i < children.length; i++) {
						if (!deleteTarget(children[i])) {
							ok = false;
							ulog("delete child fail: " + children[i].getAbsolutePath());
						}
					}
				}
			}
			if (!f.delete()) ok = false;
			return ok;
		} catch (Exception e) {
			return false;
		}
	}

	// 返回 null 表示成功，否则返回错误描述（HTTP 状态码 / 异常类型 / 具体原因）
	// expectMd5 非空时对下载结果做哈希复核，防清单与下载之间的文件变更竞态
	private static String downloadTo(String url, File dest, String expectMd5, long expectedSize) {
		HttpURLConnection conn = null;
		InputStream in = null;
		FileOutputStream out = null;
		File tmp = new File(dest.getAbsolutePath() + ".tmp");
		String err = null;
		long downloaded = 0;
		try {
			conn = (HttpURLConnection) new URL(url).openConnection();
			conn.setConnectTimeout(15000);
			conn.setReadTimeout(30000);
			conn.setUseCaches(false);
			conn.setInstanceFollowRedirects(true);
			int code = conn.getResponseCode();
			if (code != 200) {
				err = "HTTP " + code;
				return err;
			}
			long contentLength = conn.getContentLength();
			long byteTotal = expectedSize > 0 ? expectedSize : contentLength;
			if (expectedSize <= 0 && byteTotal > 0) progressBytesTotal.addAndGet(byteTotal);
			File parent = dest.getParentFile();
			if (parent != null && !parent.exists()) {
				parent.mkdirs();
			}
			in = conn.getInputStream();
			out = new FileOutputStream(tmp);
			byte[] buf = new byte[8192];
			int n;
			while ((n = in.read(buf)) != -1) {
				if (n == 0) continue;
				out.write(buf, 0, n);
				downloaded += n;
				progressBytesDone.addAndGet(n);
				updateProgress(progressDone, progressTotal, applyErrors.size());
			}
			out.flush();
			closeQuietly(in);
			in = null;
			closeQuietly(out);
			out = null;
			if (byteTotal > 0 && downloaded != byteTotal) {
				err = "文件长度不符: " + downloaded + "/" + byteTotal;
				return err;
			}
			if (expectMd5 != null) {
				String actual = md5OfFile(tmp);
				if (!expectMd5.equalsIgnoreCase(actual)) {
					err = "哈希校验失败";
					return err;
				}
			}
			if (dest.exists()) {
				dest.delete();
			}
			if (tmp.renameTo(dest)) {
				return null;
			}
			err = "重命名失败";
			return err;
		} catch (Exception e) {
			err = e.getClass().getSimpleName() + (e.getMessage() != null ? ": " + e.getMessage() : "");
			return err;
		} finally {
			closeQuietly(in);
			closeQuietly(out);
			if (conn != null) {
				conn.disconnect();
			}
			if (err != null && tmp.exists()) {
				tmp.delete();
			}
		}
	}

	private static String httpGet(String url, int timeoutMs) throws Exception {
		HttpURLConnection conn = null;
		BufferedReader reader = null;
		StringBuilder sb = new StringBuilder();
		try {
			conn = (HttpURLConnection) new URL(url).openConnection();
			conn.setConnectTimeout(timeoutMs);
			conn.setReadTimeout(timeoutMs);
			conn.setUseCaches(false);
			conn.setInstanceFollowRedirects(true);
			reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
			String line;
			while ((line = reader.readLine()) != null) {
				sb.append(line);
			}
		} catch (Exception e) {
			closeQuietly(reader);
			if (conn != null) conn.disconnect();
			throw e;
		}
		closeQuietly(reader);
		if (conn != null) conn.disconnect();
		return sb.toString();
	}

	private static JSONObject loadLocalConfig() {
		String content = readTextFile(new File(localConfigFile()));
		if (content.length() == 0) return null;
		try {
			return new JSONObject(content);
		} catch (Exception e) {
			return null;
		}
	}

	private static String loadLocalVersion() {
		JSONObject obj = loadLocalConfig();
		if (obj == null) return "";
		return obj.optString("version", "").trim();
	}

	private static String loadLocalVersionCode() {
		String content = readTextFile(new File(resRoot + "/version.json"));
		if (content.length() == 0) return "";
		try {
			return new JSONObject(content).optString("version_code", "").trim();
		} catch (Exception e) {
			return "";
		}
	}

	private static void saveLocalVersion(String version) {
		File f = new File(localConfigFile());
		JSONObject obj = new JSONObject();
		String content = readTextFile(f);
		if (content.length() > 0) {
			try {
				obj = new JSONObject(content);
			} catch (Exception e) {
				obj = new JSONObject();
			}
		}
		try {
			obj.put("version", version);
		} catch (Exception e) {
			return;
		}
		File parent = f.getParentFile();
		if (parent != null && !parent.exists()) parent.mkdirs();
		FileOutputStream out = null;
		String saveErr = null;
		try {
			out = new FileOutputStream(f);
			out.write(obj.toString().getBytes("UTF-8"));
			out.flush();
			out.close();
			out = null;
		} catch (Exception e) {
			saveErr = e.getMessage();
		}
		closeQuietly(out);
		if (saveErr != null) {
			ulog("saveLocalVersion write fail: " + saveErr);
			final String msg = saveErr;
			appendLog("版本号写入失败: " + msg);
			if (mainActivity != null) {
				mainActivity.runOnUiThread(new Runnable() {
					@Override public void run() {
						Toast.makeText(mainActivity, "KuSug.json 写入失败: " + msg, Toast.LENGTH_LONG).show();
					}
				});
			}
		} else {
			ulog("saveLocalVersion write ok: " + version);
		}
	}

	private static String readTextFile(File f) {
		if (f == null || !f.exists()) return "";
		FileInputStream in = null;
		String content = "";
		try {
			in = new FileInputStream(f);
			ByteArrayOutputStream bos = new ByteArrayOutputStream();
			byte[] buf = new byte[1024];
			int n;
			while ((n = in.read(buf)) != -1) {
				bos.write(buf, 0, n);
			}
			content = new String(bos.toByteArray(), "UTF-8");
			if (content.length() > 0 && content.charAt(0) == '\uFEFF') {
				content = content.substring(1);
			}
			content = content.trim();
		} catch (Exception e) {
			closeQuietly(in);
			return "";
		}
		closeQuietly(in);
		return content;
	}

	private static int dpI(float v) {
		float d = mainActivity != null ? mainActivity.getResources().getDisplayMetrics().density : 1f;
		return (int) (v * d + 0.5f);
	}

	private static void closeQuietly(Closeable c) {
		if (c == null) return;
		try {
			c.close();
		} catch (Throwable t) {
		}
	}
}