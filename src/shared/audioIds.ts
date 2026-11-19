/** Sound effect + voice vocabulary shared by the simulation (which emits events) and the audio engine. */
export const SFX_IDS = [
  // UI
  'uiClick', 'uiHover', 'uiOpen', 'uiClose', 'uiError', 'uiConfirm', 'uiTab', 'uiToggle', 'notify', 'notifyBad',
  'cash', 'cashLoss', 'speedChange', 'modeLive', 'modeBuild', 'modeBuy', 'save',
  // Build/buy
  'placeObject', 'placeInvalid', 'rotateObject', 'sellObject', 'pickUpObject', 'wallBuild', 'wallDelete',
  'floorPaint', 'wallPaint', 'doorPlace', 'undo',
  // Life
  'footstep', 'eat', 'drink', 'cook', 'chop', 'fridgeOpen', 'microwave', 'espresso', 'sinkWater', 'shower',
  'bathSplash', 'iceCrack', 'snore', 'yawn', 'tvStatic', 'tvChatter', 'stereoMusic', 'computerTyping',
  'arcadeBlips', 'chessClack', 'pageTurn', 'paintBrush', 'gymClank', 'embalmPump', 'stitch', 'mirrorShimmer',
  'doorOpen', 'doorbell', 'mailbox', 'phoneRing', 'phoneDial', 'carpoolHonk', 'trashLid', 'dishClatter',
  'plantChomp', 'limbDrop', 'limbReattach', 'crumble', 'reanimate', 'fireStart', 'fireLoop', 'extinguish',
  'flies', 'zap', 'kiss', 'hug', 'slap', 'laugh', 'cheer', 'partyHorn', 'promotion', 'skillUp', 'milestone',
  'fail', 'romanceSting', 'sadSting', 'powerOff', 'powerOn', 'repoGhoul', 'pizzaArrive', 'groanAmbient',
  'owl', 'wind', 'crickets', 'thunder', 'bark',
] as const;
export type SfxId = (typeof SFX_IDS)[number];

export const VOICE_EMOTIONS = [
  'neutral', 'happy', 'sad', 'angry', 'flirty', 'disgusted', 'surprised', 'laugh', 'groan', 'yawn', 'scream', 'question',
] as const;
export type VoiceEmotion = (typeof VOICE_EMOTIONS)[number];

export type MusicMood = 'menu' | 'live' | 'night' | 'build' | 'tense' | 'party' | 'sad' | 'romance' | 'caz';
