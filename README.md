# Telink BLE OTA Flasher

A browser-based flasher and configurator for Telink-based Bluetooth thermometers
(Xiaomi LYWSD03MMC, MHO-C401, MJWSD05/06/07MMC, LYWSD02MMC, Qingping CGG1/CGDK2, Tuya TS0201 and
many more). It is a rewrite of pvvx's
[TelinkMiFlasher](https://pvvx.github.io/ATC_MiThermometer/TelinkMiFlasher.html) with a modern
interface.

Everything runs in the browser over Web Bluetooth. There is no build step, and it deploys as a
static site to GitHub Pages.

## Features

- **Flash firmware over the air**: pvvx custom BLE firmware, beta, Zigbee (ZigbeeTLc), ZB, original and
  signed stock firmware from the upstream index, or any local `.bin` / `.zigbee` file or https link.
  Shows a progress bar with speed and time left, keeps the screen awake, and asks for confirmation.
- **Mi Home activation** (registration) to obtain a device's token and bind key, and **login with
  a token** for devices whose stock firmware requires Mi Home registration first.
- **Full settings for the custom firmware**: advertising format (BTHome / PVVX / ATC / Mi),
  intervals, TX power, screen options, calibration, comfort zone, GPIO trigger, reed switch,
  clock, measurement history (CSV export), PIN code, device name, MAC, bind key, SCD41 CO₂ sensor
  and a raw command console. ZigbeeTLc (BLE mode), ATC1441 and Qingping devices are supported too.
- Light and dark themes, phone-friendly layout, and an exportable log with an optional verbose mode.

The Bluetooth protocol code is a faithful port of the original page. It was verified with a
simulated device to send byte-identical GATT traffic in 16 scenarios, including activation,
login, configuration and complete OTA transfers.

## Use

Open the page in **Chrome, Edge or Opera** (desktop or Android) over HTTPS. On iOS use the
[Bluefy](https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055) browser.

1. **Connect** and pick the thermometer (press its button or reinsert the battery if it does not appear).
2. Stock firmware: press **Do activation**. If the device demands Mi Home registration
   (LYWSD03MMC 2.1.1_0159, MJWSD06MMC 2.1.1_0009, MJWSD07MMC, …), add it in the Mi Home app first,
   read its token with the
   [Xiaomi Cloud Tokens Extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor),
   then enter it and press **Login with token**.
3. Load a firmware and press **Start flashing**.
4. Reconnect to configure the custom firmware.

## Deploy on GitHub Pages

1. Create a repository and push this folder to it (the site root is the repository root).
2. On GitHub go to **Settings → Pages**, set **Source: Deploy from a branch**, then branch `main` and folder `/ (root)`.
3. After a minute the flasher is live at `https://<user>.github.io/<repository>/`.

Firmware is downloaded from the upstream repositories (`raw.githubusercontent.com`). To use your
own fork, edit `SOURCES` in [`assets/js/config.js`](assets/js/config.js).

## Development

```sh
python -m http.server 8080   # or any static server, then open http://localhost:8080
npm test                     # unit tests (Node.js 20+, no dependencies)
```

Web Bluetooth needs a secure context; `http://localhost` qualifies.

| Path | Contents |
| --- | --- |
| `index.html`, `assets/css/app.css` | page and styles |
| `assets/js/connection.js` | device chooser, service discovery, retries |
| `assets/js/mi.js` | Mi activation / login protocol |
| `assets/js/custom.js`, `settings.js` | custom firmware protocol and settings UI |
| `assets/js/firmware.js`, `ota.js`, `flasher.js` | image validation, signing, OTA transfer, firmware card |
| `tests/` | unit tests (crypto vectors, firmware validation, advertising decoders) |

## Credits

- [pvvx/ATC_MiThermometer](https://github.com/pvvx/ATC_MiThermometer): custom firmware and the
  original TelinkMiFlasher this is based on.
- [atc1441/ATC_MiThermometer](https://github.com/atc1441/ATC_MiThermometer): the original custom
  firmware and flasher.
- [PiotrMachowski/Xiaomi-cloud-tokens-extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor):
  the tool for reading device tokens from a Xiaomi account.

Flashing third-party firmware is at your own risk. See [LICENSE](LICENSE).
