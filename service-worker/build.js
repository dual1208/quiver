const { generateSW } = require("workbox-build");

generateSW({
  globDirectory: "../legacy-web/",
  globPatterns: ["**/*"],
  swDest: "../legacy-web/service-worker.js",
  sourcemap: false,
}).then(({ count, size, warnings }) => {
  if (warnings.length > 0) {
    console.warn(
      "Warnings encountered while generating a service worker:",
      warnings.join("\n")
    );
  }

  console.log(
    `Generated a service worker, which will precache ${count} files, totalling ${size} bytes.`
  );
});
