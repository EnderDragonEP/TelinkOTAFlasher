# Telink BLE OTA Flasher

A browser-based flasher and configurator for Telink-based Bluetooth thermometers
(Xiaomi LYWSD03MMC, MHO-C401, MJWSD05/06/07MMC, LYWSD02MMC, Qingping CGG1/CGDK2, Tuya TS0201 and
many more). It is a rewrite of pvvx's
[TelinkMiFlasher](https://pvvx.github.io/ATC_MiThermometer/TelinkMiFlasher.html) with a modern
interface.

Everything runs in the browser over Web Bluetooth (and Web Serial for the wired flasher). There
is no build step, and it deploys as a static site to GitHub Pages.

## Pages

| Page | What it does | Replaces pvvx's |
| --- | --- | --- |
| **Flasher** (`index.html`) | OTA flashing, Mi activation / login | TelinkMiFlasher (flashing part) |
| **Settings** (`settings.html`) | configuration of pvvx custom, ATC1441 and ZigbeeTLc (BLE mode) firmware | TelinkMiFlasher (settings part) |
| **Live data** (`live.html`) | live temperature, humidity, dew point and battery charts, CSV export; can show the dew point on the device screen | GraphAtc 1–3, DevPoint |
| **History** (`history.html`) | reads the measurement log stored on the device (custom firmware, or the hourly log of stock LYWSD03MMC), charts, min/avg/max and CSV | GraphMemo, GraphMemoOriginal |
| **OTA** (`ota.html`) | generic Telink SDK OTA with configurable service / characteristic UUIDs | TelinkOTA |
| **UART flasher** (`uart.html`) | wired flashing / recovery through a USB-UART adapter on the SWS pin (TLSR825x and TLSR8266/8269) | USBCOMFlashTx, USBCOMFlashTx8269 |

The pages work as one app: switching tabs swaps the page in place, so the device stays connected
and every tab uses the same connection (the header shows the connected device). Live data keeps
recording while you are on another tab. Links, reloads and Back / Forward work as usual; a page
opened in a new browser tab is a separate app with its own connection.

pvvx's remaining tools (advertising decoder, ZigbeeTLc index OTA, debug flash reader, power
measurements) are linked from the **More** menu.

## Features

- **Flash firmware over the air**: pvvx custom BLE firmware, beta, Zigbee (ZigbeeTLc), ZB, original and
  signed stock firmware from the upstream index, or any local `.bin` / `.zigbee` file or https link.
  Shows a progress bar with speed and time left, keeps the screen awake, and asks for confirmation.
- **Mi Home activation** (registration) to obtain a device's token and bind key, and **login with
  a token** for devices whose stock firmware requires Mi Home registration first.
- **Full settings for the custom firmware** (Settings page): advertising format (BTHome / PVVX / ATC / Mi),
  intervals, TX power, screen options, calibration, comfort zone, GPIO trigger, reed switch,
  clock, measurement history (CSV export), PIN code, device name, MAC, bind key, SCD41 CO₂ sensor
  and a raw command console. ZigbeeTLc (BLE mode) and ATC1441 devices are supported too.
- Follows the device's light/dark theme (the header button switches it for the current page), phone-friendly layout, and an exportable log with an optional verbose mode.

The protocol code is a faithful port of the original pages. It was verified against them with a
simulated device and USB-UART adapter: byte-identical GATT and serial traffic, including
activation, login, configuration, history reading and complete OTA / UART transfers.

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
4. Open **Settings** and press **Reconnect** once the device has restarted (no need to pick it again) to configure the custom firmware.

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
| `index.html`, `settings.html`, `live.html`, `history.html`, `ota.html`, `uart.html` | pages |
| `assets/css/app.css` | styles (light / dark themes) |
| `assets/js/app.js` | single-page shell: switches views in place, loads each page's markup |
| `assets/js/device-hub.js` | the Bluetooth device and connection shared by every view |
| `assets/js/site.js` | shared header, navigation, theme, log and name filter |
| `assets/js/pages/` | the views (Flasher + Settings, Live data, History, OTA, UART) |
| `assets/js/connection.js` | device chooser, service discovery, retries, per-page routing |
| `assets/js/mi.js` | Mi activation / login protocol |
| `assets/js/custom.js`, `settings.js` | custom firmware protocol and settings UI |
| `assets/js/firmware.js`, `ota.js`, `flasher.js`, `progress.js` | image validation, signing, OTA transfer, firmware card, progress |
| `assets/js/ble-session.js` | small connection helper for the tool views |
| `assets/js/measure.js`, `chart.js` | measurement parsing, dew point, CSV; charts (uPlot) |
| `assets/js/swire.js` | SWire-over-UART encoding and flash programming |
| `assets/vendor/uplot/` | [uPlot](https://github.com/leeoniya/uPlot) 1.6.32 (MIT), served locally |
| `tests/` | unit tests (crypto vectors, firmware validation, advertising decoders, SWire encoding, parsers) |

## Credits

- [pvvx/ATC_MiThermometer](https://github.com/pvvx/ATC_MiThermometer): custom firmware and the
  original TelinkMiFlasher this is based on.
- [atc1441/ATC_MiThermometer](https://github.com/atc1441/ATC_MiThermometer): the original custom
  firmware and flasher.
- [leeoniya/uPlot](https://github.com/leeoniya/uPlot): the chart library (MIT).
- [PiotrMachowski/Xiaomi-cloud-tokens-extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor):
  the tool for reading device tokens from a Xiaomi account.

Flashing third-party firmware is at your own risk. See [LICENSE](LICENSE).
