import {
  AndroidConfig,
  withStringsXml,
  type ConfigPlugin,
} from "expo/config-plugins";
import type { ConfigContext, ExpoConfig } from "expo/config";

type AndroidDisplayNameOptions = Readonly<{
  displayName: string;
}>;

const withAndroidDisplayName: ConfigPlugin<AndroidDisplayNameOptions> = (
  config,
  { displayName },
) =>
  withStringsXml(config, (modConfig) => {
    modConfig.modResults = AndroidConfig.Strings.setStringItem(
      [
        AndroidConfig.Resources.buildResourceItem({
          name: "app_name",
          value: displayName,
        }),
      ],
      modConfig.modResults,
    );

    return modConfig;
  });

export default ({ config }: ConfigContext): ExpoConfig => {
  const labSmoke = process.env.APP_VARIANT === "lab";
  const displayName = labSmoke ? "Quiver Lab" : "Quiver";
  const expoConfig: ExpoConfig = {
    ...config,
    name: "Quiver",
    slug: "quiver-native",
    scheme: "quiver",
    orientation: "default",
    icon: "./assets/images/icon.png",
    ios: {
      bundleIdentifier: "app.quiver.native",
      icon: "./assets/expo.icon",
      infoPlist: {
        CFBundleDisplayName: displayName,
      },
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#191919",
        backgroundImage: "./assets/images/android-icon-background.png",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      blockedPermissions: [
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.SYSTEM_ALERT_WINDOW",
      ],
      package: "app.quiver.native",
      permissions: [
        "android.permission.INTERNET",
        "android.permission.VIBRATE",
      ],
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          backgroundColor: "#191919",
          image: "./assets/images/splash-icon.png",
          imageWidth: 96,
        },
      ],
      "expo-sqlite",
      "expo-sharing",
      "expo-status-bar",
      [
        "expo-build-properties",
        {
          android: {
            minSdkVersion: 24,
          },
          ios: {
            deploymentTarget: "16.4",
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      ...config.extra,
      labSmoke,
    },
  };

  return withAndroidDisplayName(expoConfig, { displayName });
};
