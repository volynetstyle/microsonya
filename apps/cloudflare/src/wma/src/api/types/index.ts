/**
 * Telegram Mini Apps JavaScript API declarations, current through Bot API 9.6.
 *
 * Runtime values are injected by `telegram-web-app.js`; this module contains
 * types only. Data from `initDataUnsafe` must never be trusted on a server.
 * Validate the raw `initData` string there instead.
 *
 * @see https://core.telegram.org/bots/webapps#initializing-mini-apps
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

/** Telegram client's active appearance. */
export type TelegramColorScheme = "light" | "dark";
/** Platform identifier reported by the Telegram client. */
export type TelegramPlatform =
  | "ios"
  | "android"
  | "android_x"
  | "macos"
  | "tdesktop"
  | "web"
  | "weba"
  | "webk"
  | "unigram"
  | "unknown";
/** CSS-style hexadecimal color used by the Mini Apps API. */
export type HexColor = `#${string}`;

/**
 * Optional colors supplied by the user's current Telegram theme.
 * Values can change at runtime; subscribe to `themeChanged`.
 *
 * @see https://core.telegram.org/bots/webapps#themeparams
 */
export interface TelegramThemeParams {
  bg_color?: HexColor;
  text_color?: HexColor;
  hint_color?: HexColor;
  link_color?: HexColor;
  button_color?: HexColor;
  button_text_color?: HexColor;
  secondary_bg_color?: HexColor;
  header_bg_color?: HexColor;
  bottom_bar_bg_color?: HexColor;
  accent_text_color?: HexColor;
  section_bg_color?: HexColor;
  section_header_text_color?: HexColor;
  section_separator_color?: HexColor;
  subtitle_text_color?: HexColor;
  destructive_text_color?: HexColor;
}

/**
 * System UI avoidance insets, in pixels.
 * @see https://core.telegram.org/bots/webapps#safeareainset
 */
export interface TelegramSafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
/**
 * Insets that additionally exclude Telegram UI overlapping app content.
 * @see https://core.telegram.org/bots/webapps#contentsafeareainset
 */
export type ContentSafeAreaInset = TelegramSafeAreaInset;

/**
 * User data transferred in Mini App initialization data.
 * @see https://core.telegram.org/bots/webapps#webappuser
 */
export interface WebAppUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: true;
  added_to_attachment_menu?: true;
  allows_write_to_pm?: true;
  photo_url?: string;
}

/**
 * Chat data transferred for attachment-menu launches.
 * @see https://core.telegram.org/bots/webapps#webappchat
 */
export interface WebAppChat {
  id: number;
  type: "group" | "supergroup" | "channel";
  title: string;
  username?: string;
  photo_url?: string;
}

/**
 * Parsed initialization data exposed as `initDataUnsafe`.
 *
 * Do not trust this object on a server. Validate `initData` before parsing it.
 * @see https://core.telegram.org/bots/webapps#webappinitdata
 */
export interface WebAppInitData {
  query_id?: string;
  user?: WebAppUser;
  receiver?: WebAppUser;
  chat?: WebAppChat;
  chat_type?: "sender" | "private" | "group" | "supergroup" | "channel";
  chat_instance?: string;
  start_param?: string;
  can_send_after?: number;
  auth_date: number;
  hash: string;
  signature?: string;
}

/** @see https://core.telegram.org/bots/webapps#storywidgetlink */
export interface StoryWidgetLink {
  url: string;
  name?: string;
}
/** Native story editor options. @see https://core.telegram.org/bots/webapps#storyshareparams */
export interface StoryShareParams {
  text?: string;
  widget_link?: StoryWidgetLink;
}
/** Native QR scanner options. @see https://core.telegram.org/bots/webapps#scanqrpopupparams */
export interface ScanQrPopupParams {
  text?: string;
}
/** Emoji-status lifetime options. @see https://core.telegram.org/bots/webapps#emojistatusparams */
export interface EmojiStatusParams {
  duration?: number;
}
/** File download request. @see https://core.telegram.org/bots/webapps#downloadfileparams */
export interface DownloadFileParams {
  url: string;
  file_name: string;
}

/** Native popup button presentation. */
export type PopupButtonType =
  | "default"
  | "ok"
  | "close"
  | "cancel"
  | "destructive";
/** @see https://core.telegram.org/bots/webapps#popupbutton */
export interface PopupButton {
  id?: string;
  type?: PopupButtonType;
  text?: string;
}
/** Native popup contents. @see https://core.telegram.org/bots/webapps#popupparams */
export interface PopupParams {
  title?: string;
  message: string;
  buttons?: PopupButton[];
}

/** Resolves to a zero-argument or payload-bearing handler for an event. */
export type EventHandler<T = void> = [T] extends [void]
  ? () => void
  : (event: T) => void;
/**
 * Maps every Telegram Mini Apps event name to the payload received by its
 * handler. `void` means that Telegram passes no parameters.
 *
 * @example
 * webApp.onEvent("viewportChanged", ({ isStateStable }) => {
 *   if (isStateStable) console.log(webApp.viewportStableHeight);
 * });
 *
 * @see https://core.telegram.org/bots/webapps#events-available-for-mini-apps
 */
export interface TelegramWebAppEventMap {
  /** Bot API 8.0+: Mini App became active. */
  activated: void;
  /** Bot API 8.0+: Mini App became inactive or minimized. */
  deactivated: void;
  /** Telegram theme colors or light/dark scheme changed. */
  themeChanged: void;
  /** Visible area changed; stable is true after gestures finish. */
  viewportChanged: { isStateStable: boolean };
  /** Bot API 8.0+: system safe-area insets changed. */
  safeAreaChanged: void;
  /** Bot API 8.0+: Telegram content safe-area insets changed. */
  contentSafeAreaChanged: void;
  /** Native main bottom button was pressed. */
  mainButtonClicked: void;
  /** Bot API 7.10+: native secondary bottom button was pressed. */
  secondaryButtonClicked: void;
  /** Bot API 6.1+: native back button was pressed. */
  backButtonClicked: void;
  /** Native settings context-menu item was pressed. */
  settingsButtonClicked: void;
  /** Bot API 6.1+: an invoice was closed. */
  invoiceClosed: {
    url: string;
    status: "paid" | "cancelled" | "failed" | "pending";
  };
  /** Bot API 6.2+: popup closed; id is null if no button was pressed. */
  popupClosed: { button_id: string | null };
  /** Bot API 6.4+: QR scanner recognized textual data. */
  qrTextReceived: { data: string };
  /** Bot API 7.7+: user closed the QR scanner. */
  scanQrPopupClosed: void;
  /** Bot API 6.4+: clipboard read completed; null means no access. */
  clipboardTextReceived: { data: string | null };
  /** Bot API 6.9+: write-access request completed. */
  writeAccessRequested: { status: "allowed" | "cancelled" };
  /** Bot API 6.9+: phone-number request completed. */
  contactRequested: { status: "sent" | "cancelled" };
  /** Bot API 7.2+: biometric manager state changed. */
  biometricManagerUpdated: void;
  /** Bot API 7.2+: biometric authentication completed. */
  biometricAuthRequested: { isAuthenticated: boolean; biometricToken?: string };
  /** Bot API 7.2+: biometric-token update completed. */
  biometricTokenUpdated: { isUpdated: boolean };
  /** Bot API 8.0+: fullscreen state changed. */
  fullscreenChanged: void;
  /** Bot API 8.0+: entering fullscreen failed. */
  fullscreenFailed: { error: string };
  /** Bot API 8.0+: Mini App was added to the home screen. */
  homeScreenAdded: void;
  /** Bot API 8.0+: home-screen status check completed. */
  homeScreenChecked: { status: HomeScreenStatus };
  /** Bot API 8.0+: accelerometer tracking started. */
  accelerometerStarted: void;
  /** Bot API 8.0+: accelerometer tracking stopped. */
  accelerometerStopped: void;
  /** Bot API 8.0+: accelerometer values changed. */
  accelerometerChanged: void;
  /** Bot API 8.0+: accelerometer request failed. */
  accelerometerFailed: { error: string };
  /** Bot API 8.0+: orientation tracking started. */
  deviceOrientationStarted: void;
  /** Bot API 8.0+: orientation tracking stopped. */
  deviceOrientationStopped: void;
  /** Bot API 8.0+: orientation values changed. */
  deviceOrientationChanged: void;
  /** Bot API 8.0+: orientation request failed. */
  deviceOrientationFailed: { error: string };
  /** Bot API 8.0+: gyroscope tracking started. */
  gyroscopeStarted: void;
  /** Bot API 8.0+: gyroscope tracking stopped. */
  gyroscopeStopped: void;
  /** Bot API 8.0+: gyroscope values changed. */
  gyroscopeChanged: void;
  /** Bot API 8.0+: gyroscope request failed. */
  gyroscopeFailed: { error: string };
  /** Bot API 8.0+: location manager state changed. */
  locationManagerUpdated: void;
  /** Bot API 8.0+: native location request completed. */
  locationRequested: { locationData: LocationData | null };
  /** Bot API 8.0+: user shared a prepared message. */
  shareMessageSent: void;
  /** Bot API 8.0+: prepared-message sharing failed. */
  shareMessageFailed: { error: ShareMessageError };
  /** Bot API 8.0+: custom emoji status was set. */
  emojiStatusSet: void;
  /** Bot API 8.0+: setting a custom emoji status failed. */
  emojiStatusFailed: { error: string };
  /** Bot API 8.0+: emoji-status permission request completed. */
  emojiStatusAccessRequested: { status: EmojiStatusAccessStatus };
  /** Bot API 8.0+: user responded to a file-download request. */
  fileDownloadRequested: { status: "downloading" | "downloaded" | "cancelled" };
}
/** Any event accepted by `Telegram.WebApp.onEvent` and `offEvent`. */
export type TelegramWebAppEvent = keyof TelegramWebAppEventMap;

/** Shared fluent API implemented by Telegram's native clickable controls. */
interface ClickableControl<Self> {
  isVisible: boolean;
  onClick(callback: () => void): Self;
  offClick(callback: () => void): Self;
  show(): Self;
  hide(): Self;
}
/** Native header back button. @see https://core.telegram.org/bots/webapps#backbutton */
export interface BackButton extends ClickableControl<BackButton> {}
/** Native context-menu settings item. @see https://core.telegram.org/bots/webapps#settingsbutton */
export interface SettingsButton extends ClickableControl<SettingsButton> {}

/** Layout position supported by the secondary bottom button. */
export type BottomButtonPosition = "left" | "right" | "top" | "bottom";
/** Mutable native bottom-button properties accepted by `setParams`. */
export interface BottomButtonParams {
  icon_custom_emoji_id?: string;
  text?: string;
  color?: HexColor;
  text_color?: HexColor;
  has_shine_effect?: boolean;
  position?: BottomButtonPosition;
  is_active?: boolean;
  is_visible?: boolean;
}
/**
 * Telegram-controlled main or secondary button rendered below the Mini App.
 * All mutating methods are fluent and return this button.
 *
 * @see https://core.telegram.org/bots/webapps#bottombutton
 */
export interface BottomButton extends ClickableControl<BottomButton> {
  readonly type: "main" | "secondary";
  iconCustomEmojiId: string;
  text: string;
  color: HexColor;
  textColor: HexColor;
  isActive: boolean;
  hasShineEffect: boolean;
  position?: BottomButtonPosition;
  readonly isProgressVisible: boolean;
  setText(text: string): BottomButton;
  enable(): BottomButton;
  disable(): BottomButton;
  showProgress(leaveActive?: boolean): BottomButton;
  hideProgress(): BottomButton;
  setParams(params: BottomButtonParams): BottomButton;
}

/**
 * Triggers native impact, notification, and selection feedback.
 * @see https://core.telegram.org/bots/webapps#hapticfeedback
 */
export interface HapticFeedback {
  impactOccurred(
    style: "light" | "medium" | "heavy" | "rigid" | "soft",
  ): HapticFeedback;
  notificationOccurred(type: "error" | "success" | "warning"): HapticFeedback;
  selectionChanged(): HapticFeedback;
}

/** `null` on success; otherwise the Telegram storage error description. */
type StorageError = string | null;
type WriteCallback = (error: StorageError, success?: boolean) => void;
/**
 * Per-user storage synchronized by Telegram (up to 1024 items).
 * @see https://core.telegram.org/bots/webapps#cloudstorage
 */
export interface CloudStorage {
  setItem(key: string, value: string, callback?: WriteCallback): CloudStorage;
  getItem(
    key: string,
    callback: (error: StorageError, value?: string) => void,
  ): CloudStorage;
  getItems(
    keys: string[],
    callback: (error: StorageError, values?: Record<string, string>) => void,
  ): CloudStorage;
  removeItem(key: string, callback?: WriteCallback): CloudStorage;
  removeItems(keys: string[], callback?: WriteCallback): CloudStorage;
  getKeys(
    callback: (error: StorageError, keys?: string[]) => void,
  ): CloudStorage;
}
/**
 * Persistent local device storage (Bot API 9.0+, up to 5 MB per user).
 * @see https://core.telegram.org/bots/webapps#devicestorage
 */
export interface DeviceStorage {
  setItem(key: string, value: string, callback?: WriteCallback): DeviceStorage;
  getItem(
    key: string,
    callback: (error: StorageError, value?: string) => void,
  ): DeviceStorage;
  removeItem(key: string, callback?: WriteCallback): DeviceStorage;
  clear(callback?: WriteCallback): DeviceStorage;
}
/**
 * Encrypted device storage backed by Keychain/Keystore (Bot API 9.0+).
 * It is limited to 10 items per bot and user.
 *
 * @see https://core.telegram.org/bots/webapps#securestorage
 */
export interface SecureStorage {
  setItem(key: string, value: string, callback?: WriteCallback): SecureStorage;
  getItem(
    key: string,
    callback: (
      error: StorageError,
      value?: string | null,
      canRestore?: boolean,
    ) => void,
  ): SecureStorage;
  restoreItem(
    key: string,
    callback?: (error: StorageError, value?: string) => void,
  ): SecureStorage;
  removeItem(key: string, callback?: WriteCallback): SecureStorage;
  clear(callback?: WriteCallback): SecureStorage;
}

/** @see https://core.telegram.org/bots/webapps#biometricrequestaccessparams */
export interface BiometricRequestAccessParams {
  reason?: string;
}
/** @see https://core.telegram.org/bots/webapps#biometricauthenticateparams */
export interface BiometricAuthenticateParams {
  reason?: string;
}
/**
 * Device biometric authentication and secure biometric-token management.
 * Call `init()` before using the remaining operations.
 *
 * @see https://core.telegram.org/bots/webapps#biometricmanager
 */
export interface BiometricManager {
  isInited: boolean;
  isBiometricAvailable: boolean;
  biometricType: "finger" | "face" | "unknown";
  isAccessRequested: boolean;
  isAccessGranted: boolean;
  isBiometricTokenSaved: boolean;
  deviceId: string;
  init(callback?: () => void): BiometricManager;
  requestAccess(
    params: BiometricRequestAccessParams,
    callback?: (granted: boolean) => void,
  ): BiometricManager;
  authenticate(
    params: BiometricAuthenticateParams,
    callback?: (success: boolean, token?: string) => void,
  ): BiometricManager;
  updateBiometricToken(
    token: string,
    callback?: (updated: boolean) => void,
  ): BiometricManager;
  openSettings(): BiometricManager;
}

/** Sensor refresh interval in milliseconds (20–1000; default 1000). */
export interface MotionSensorStartParams {
  refresh_rate?: number;
}
/** @see https://core.telegram.org/bots/webapps#accelerometerstartparams */
export type AccelerometerStartParams = MotionSensorStartParams;
/** @see https://core.telegram.org/bots/webapps#gyroscopestartparams */
export type GyroscopeStartParams = MotionSensorStartParams;
/** @see https://core.telegram.org/bots/webapps#deviceorientationstartparams */
export interface DeviceOrientationStartParams extends MotionSensorStartParams {
  need_absolute?: boolean;
}
interface MotionSensor<Self, Params> {
  isStarted: boolean;
  start(params: Params, callback?: (started: boolean) => void): Self;
  stop(callback?: (stopped: boolean) => void): Self;
}
/** Linear acceleration in m/s². @see https://core.telegram.org/bots/webapps#accelerometer */
export interface Accelerometer extends MotionSensor<
  Accelerometer,
  MotionSensorStartParams
> {
  x: number;
  y: number;
  z: number;
}
/** Rotation rates in rad/s. @see https://core.telegram.org/bots/webapps#gyroscope */
export interface Gyroscope extends MotionSensor<
  Gyroscope,
  MotionSensorStartParams
> {
  x: number;
  y: number;
  z: number;
}
/** Device rotation angles in radians. @see https://core.telegram.org/bots/webapps#deviceorientation */
export interface DeviceOrientation extends MotionSensor<
  DeviceOrientation,
  DeviceOrientationStartParams
> {
  absolute: boolean;
  alpha: number;
  beta: number;
  gamma: number;
}
/** Current device location and nullable accuracy metadata. @see https://core.telegram.org/bots/webapps#locationdata */
export interface LocationData {
  latitude: number;
  longitude: number;
  altitude: number | null;
  course: number | null;
  speed: number | null;
  horizontal_accuracy: number | null;
  vertical_accuracy: number | null;
  course_accuracy: number | null;
  speed_accuracy: number | null;
}
/**
 * Native device location access. Call `init()` before requesting a location.
 * @see https://core.telegram.org/bots/webapps#locationmanager
 */
export interface LocationManager {
  isInited: boolean;
  isLocationAvailable: boolean;
  isAccessRequested: boolean;
  isAccessGranted: boolean;
  init(callback?: () => void): LocationManager;
  getLocation(
    callback: (location: LocationData | null) => void,
  ): LocationManager;
  openSettings(): LocationManager;
}

export type HomeScreenStatus = "unsupported" | "unknown" | "added" | "missed";
export type EmojiStatusAccessStatus = "allowed" | "cancelled";
export type EmojiStatusSetStatus = "set" | "failed";
export type InvoiceStatus = "paid" | "cancelled" | "failed" | "pending";
export type ShareMessageError =
  | "UNSUPPORTED"
  | "MESSAGE_EXPIRED"
  | "MESSAGE_SEND_FAILED"
  | "USER_DECLINED"
  | "UNKNOWN_ERROR";

/**
 * Root object injected as `window.Telegram.WebApp` by Telegram's SDK script.
 *
 * Feature availability depends on the client Bot API version. Use
 * `isVersionAtLeast()` before calling newer APIs on older clients.
 *
 * @see https://core.telegram.org/bots/webapps#initializing-mini-apps
 */
export interface TelegramWebApp {
  /** Raw, server-verifiable initialization query string. */
  initData: string;
  /** Parsed but untrusted initialization data; never trust it on the server. */
  initDataUnsafe: WebAppInitData;
  /** Bot API version supported by the current Telegram client. */
  version: string;
  /** Current Telegram client platform. */
  platform: TelegramPlatform;
  /** Current light/dark appearance; updated with `themeChanged`. */
  colorScheme: TelegramColorScheme;
  /** Current optional Telegram theme colors. */
  themeParams: TelegramThemeParams;
  /** Bot API 8.0+: whether the Mini App is currently active, not minimized. */
  isActive: boolean;
  /** Whether the Mini App occupies the maximum available height. */
  isExpanded: boolean;
  /** Current visible height; may change continuously during gestures. */
  viewportHeight: number;
  /** Visible height after the latest completed gesture or animation. */
  viewportStableHeight: number;
  /** Current native header color in `#RRGGBB` format. */
  headerColor: string;
  /** Current Mini App background color in `#RRGGBB` format. */
  backgroundColor: string;
  /** Bot API 7.10+: current native bottom-bar color. */
  bottomBarColor: string;
  /** Whether closing the Mini App requires user confirmation. */
  isClosingConfirmationEnabled: boolean;
  /** Whether vertical swipes may minimize or close the Mini App. */
  isVerticalSwipesEnabled: boolean;
  /** Bot API 8.0+: whether the Mini App is displayed fullscreen. */
  isFullscreen: boolean;
  /** Bot API 8.0+: whether device orientation is currently locked. */
  isOrientationLocked: boolean;
  /** Insets needed to avoid system UI. */
  safeAreaInset: TelegramSafeAreaInset;
  /** Insets needed to avoid Telegram UI overlapping app content. */
  contentSafeAreaInset: ContentSafeAreaInset;
  /** Native header back button controller. */
  BackButton: BackButton;
  /** Native primary bottom button controller. */
  MainButton: BottomButton;
  /** Bot API 7.10+: native secondary bottom button controller. */
  SecondaryButton: BottomButton;
  /** Native context-menu settings item controller. */
  SettingsButton: SettingsButton;
  /** Native haptic feedback controller. */
  HapticFeedback: HapticFeedback;
  /** Telegram-synchronized per-user key/value storage. */
  CloudStorage: CloudStorage;
  /** Device biometric authentication controller. */
  BiometricManager: BiometricManager;
  /** Bot API 8.0+: device accelerometer controller. */
  Accelerometer: Accelerometer;
  /** Bot API 8.0+: device orientation controller. */
  DeviceOrientation: DeviceOrientation;
  /** Bot API 8.0+: device gyroscope controller. */
  Gyroscope: Gyroscope;
  /** Bot API 8.0+: native location controller. */
  LocationManager: LocationManager;
  /** Bot API 9.0+: persistent, device-local key/value storage. */
  DeviceStorage: DeviceStorage;
  /** Bot API 9.0+: encrypted device-local key/value storage. */
  SecureStorage: SecureStorage;
  /** Returns whether the client supports at least the requested Bot API version. */
  isVersionAtLeast(version: string): boolean;
  /** Bot API 6.1+: changes Telegram's native Mini App header color. */
  setHeaderColor(color: HexColor | "bg_color" | "secondary_bg_color"): void;
  /** Bot API 6.1+: changes the Mini App background color. */
  setBackgroundColor(color: HexColor | "bg_color" | "secondary_bg_color"): void;
  /** Bot API 7.10+: changes the native bottom/navigation bar color. */
  setBottomBarColor(
    color: HexColor | "bg_color" | "secondary_bg_color" | "bottom_bar_bg_color",
  ): void;
  /** Bot API 6.2+: asks for confirmation when the user closes the Mini App. */
  enableClosingConfirmation(): void;
  /** Bot API 6.2+: disables closing confirmation. */
  disableClosingConfirmation(): void;
  /** Bot API 7.7+: enables swipe-to-minimize/close gestures. */
  enableVerticalSwipes(): void;
  /** Bot API 7.7+: disables swipe-to-minimize/close gestures. */
  disableVerticalSwipes(): void;
  /** Bot API 8.0+: requests fullscreen presentation. */
  requestFullscreen(): void;
  /** Bot API 8.0+: exits fullscreen presentation. */
  exitFullscreen(): void;
  /** Bot API 8.0+: locks the current portrait/landscape orientation. */
  lockOrientation(): void;
  /** Bot API 8.0+: restores automatic orientation changes. */
  unlockOrientation(): void;
  /** Bot API 8.0+: prompts the user to add the Mini App to their home screen. */
  addToHomeScreen(): void;
  /** Bot API 8.0+: reports home-screen feature/install status. */
  checkHomeScreenStatus(callback?: (status: HomeScreenStatus) => void): void;
  /** Registers a handler whose payload is inferred from the event name. */
  onEvent<E extends TelegramWebAppEvent>(
    event: E,
    handler: EventHandler<TelegramWebAppEventMap[E]>,
  ): void;
  /** Removes a previously registered handler using the same function reference. */
  offEvent<E extends TelegramWebAppEvent>(
    event: E,
    handler: EventHandler<TelegramWebAppEventMap[E]>,
  ): void;
  /** Sends up to 4096 bytes to a keyboard-button bot and closes the Mini App. */
  sendData(data: string): void;
  /** Bot API 6.7+: inserts an inline query, optionally after choosing a chat. */
  switchInlineQuery(
    query: string,
    choose_chat_types?: Array<"users" | "bots" | "groups" | "channels">,
  ): void;
  /** Opens an external URL; `try_instant_view` requires Bot API 6.4+. */
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  /** Opens a `t.me` link inside Telegram without closing the Mini App. */
  openTelegramLink(url: string): void;
  /** Bot API 7.8+: opens Telegram's native story editor. */
  shareToStory(media_url: string, params?: StoryShareParams): void;
  /** Bot API 8.0+: shares a Bot API `PreparedInlineMessage`. */
  shareMessage(msg_id: string, callback?: (shared: boolean) => void): void;
  /** Bot API 8.0+: asks the user to set a custom emoji status. */
  setEmojiStatus(
    custom_emoji_id: string,
    params?: EmojiStatusParams,
    callback?: (success: boolean) => void,
  ): void;
  /** Bot API 8.0+: requests permission to manage the user's emoji status. */
  requestEmojiStatusAccess(callback?: (allowed: boolean) => void): void;
  /** Bot API 8.0+: requests a native HTTPS file download. */
  downloadFile(
    params: DownloadFileParams,
    callback?: (accepted: boolean) => void,
  ): void;
  /** Bot API 6.1+: opens an invoice and reports its final/current status. */
  openInvoice(url: string, callback?: (status: InvoiceStatus) => void): void;
  /** Bot API 6.2+: displays a native popup with up to three buttons. */
  showPopup(
    params: PopupParams,
    callback?: (buttonId: string | null) => void,
  ): void;
  /** Displays a native alert with one localized OK button. */
  showAlert(message: string, callback?: () => void): void;
  /** Displays a native confirmation dialog. */
  showConfirm(message: string, callback?: (confirmed: boolean) => void): void;
  /** Bot API 6.4+: opens the native QR scanner. Return `true` to close it. */
  showScanQrPopup(
    params: ScanQrPopupParams,
    callback?: (text: string) => boolean | void,
  ): void;
  /** Bot API 6.4+: closes the QR scanner if it is open. */
  closeScanQrPopup(): void;
  /** Bot API 6.4+: reads clipboard text when client permissions allow it. */
  readTextFromClipboard(callback?: (text: string | null) => void): void;
  /** Bot API 6.9+: asks permission for the bot to message the user. */
  requestWriteAccess(callback?: (granted: boolean) => void): void;
  /** Bot API 6.9+: asks the user to share their phone number with the bot. */
  requestContact(callback?: (shared: boolean) => void): void;
  /** Bot API 9.6+: opens a chat picker for a `PreparedKeyboardButton` request. */
  requestChat(req_id: number, callback?: (sent: boolean) => void): void;
  /** Hides Telegram's loading placeholder; call after essential UI is ready. */
  ready(): void;
  /** Expands the Mini App to the maximum available height. */
  expand(): void;
  /** Closes the Mini App. */
  close(): void;
}

declare global {
  interface Window {
    /** Object injected by Telegram's `telegram-web-app.js` runtime. */
    Telegram?: { WebApp?: TelegramWebApp };
  }
}
