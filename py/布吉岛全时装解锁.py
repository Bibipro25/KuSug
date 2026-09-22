# -*- coding: utf-8 -*-
"""
PocketFashion local recording mode (NetEase Minecraft Python 2.7).

Run this code inside the game client's Python executor after entering the
server lobby.  It only changes the current client's in-memory fashion lists;
it does not change the account database or grant server-side ownership.
Restarting the client restores the original state.
"""

import mod.client.extraClientApi as clientApi

from PocketFashionScripts.manager.fashion import AllFashionConfig
from PocketFashionScripts.manager.fashion import OwnedFashion
from PocketFashionScripts.manager.fashion import PlayerFashionConfig
from PocketFashionScripts.manager.emote import AllEmoteConfig
from PocketFashionScripts.manager.emote import PlayerEmoteConfig


PERMANENT_EXPIRE_TIME_MS = 4102444800000  # 2100-01-01, displayed as permanent
MAX_RETRIES = 15
RETRY_SECONDS = 1.0


def _grant_all_fashions(player_config=None):
    if player_config is None:
        player_config = PlayerFashionConfig()

    for name, fashion in AllFashionConfig.fashions.iteritems():
        owned = player_config.owned_fashions.get(name)
        if owned is None:
            player_config.owned_fashions[name] = OwnedFashion(
                name,
                group=fashion.group,
                expireTime=PERMANENT_EXPIRE_TIME_MS,
                isExpire=False,
            )
        else:
            owned.isExpire = False
            owned.expireTime = PERMANENT_EXPIRE_TIME_MS
            if owned.group is None:
                owned.group = fashion.group

    player_config.refresh()
    return len(player_config.owned_fashions)


def _grant_all_emotes(player_config=None):
    if player_config is None:
        player_config = PlayerEmoteConfig()

    player_config.owned_emotes[:] = sorted(AllEmoteConfig.emotes.keys())
    player_config.unlock_num = max(6, player_config.unlock_num)
    while len(player_config.equiped_emote) < player_config.unlock_num:
        player_config.equiped_emote.append(None)
    player_config.refresh()
    return player_config.total_owned


def _install_resync_hooks():
    # Keep recording mode active if the server resends the real ownership list.
    if not hasattr(PlayerFashionConfig, '_recording_original_update'):
        PlayerFashionConfig._recording_original_update = \
            PlayerFashionConfig.update_from_config

        def _recording_fashion_update(self, config):
            PlayerFashionConfig._recording_original_update(self, config)
            _grant_all_fashions(self)

        PlayerFashionConfig.update_from_config = _recording_fashion_update

    if not hasattr(PlayerEmoteConfig, '_recording_original_update'):
        PlayerEmoteConfig._recording_original_update = \
            PlayerEmoteConfig.update_from_config

        def _recording_emote_update(self, config):
            PlayerEmoteConfig._recording_original_update(self, config)
            _grant_all_emotes(self)

        PlayerEmoteConfig.update_from_config = _recording_emote_update


def _install_local_only_hooks(system):
    """Keep preview/equip actions local instead of claiming server ownership."""
    if system is None:
        return None

    module = getattr(system, 'PocketFashionClientModule', None)
    if module is not None:
        if not hasattr(module, '_recording_original_close_persona'):
            module._recording_original_close_persona = module.OnClosePersona

            def _recording_close_persona():
                # Original method still rebuilds the local render controllers.
                # Clearing dirty prevents PlayerChangeFashionEvent from being sent.
                module.dirty = False
                return module._recording_original_close_persona()

            module.OnClosePersona = _recording_close_persona

        if not hasattr(module, '_recording_original_change_emotes'):
            module._recording_original_change_emotes = \
                module.OnPlayerChangeEquipedEmotes

            def _recording_change_emotes():
                return None

            module.OnPlayerChangeEquipedEmotes = _recording_change_emotes

    wheel = getattr(system, 'EmoteWheelClientModule', None)
    if wheel is not None:
        if not hasattr(wheel, '_recording_original_select_emote'):
            wheel._recording_original_select_emote = wheel.PlayerSelectEmote

            def _recording_select_emote(key):
                return wheel.emote_controller.play_emote(wheel.playerId, key)

            wheel.PlayerSelectEmote = _recording_select_emote

        if not hasattr(wheel, '_recording_original_select_default_emote'):
            wheel._recording_original_select_default_emote = \
                wheel.PlayerSelectDefaultEmote

            def _recording_select_default_emote():
                for key in wheel.player_emote.equiped_emote:
                    if key:
                        return wheel.emote_controller.play_emote(
                            wheel.playerId, key
                        )
                return None

            wheel.PlayerSelectDefaultEmote = _recording_select_default_emote

    return module


_recording_retry_count = [0]


def enable_recording_mode():
    _recording_retry_count[0] += 1
    _install_resync_hooks()

    fashion_count = _grant_all_fashions()
    emote_count = _grant_all_emotes()

    system = clientApi.GetSystem(
        'PocketFashion', 'PocketFashionClientSystem'
    )
    module = _install_local_only_hooks(system)

    configs_ready = bool(AllFashionConfig.fashions or AllEmoteConfig.emotes)
    if not configs_ready and _recording_retry_count[0] < MAX_RETRIES:
        game = clientApi.GetEngineCompFactory().CreateGame(
            clientApi.GetLevelId()
        )
        game.AddTimer(RETRY_SECONDS, enable_recording_mode)
        print('[PocketFashion recording] waiting for server config...')
        return False

    print('[PocketFashion recording] enabled: fashions=%d, emotes=%d' % (
        fashion_count, emote_count
    ))

    if module is not None:
        module.OpenPersonaNode()
    else:
        print('[PocketFashion recording] system not ready; open the menu manually.')
    return True


enable_recording_mode()
