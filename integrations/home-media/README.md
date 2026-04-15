# Home Media Integration

Turn your WhatsApp into a remote control for your home media server.

## Stack

| Service | Purpose | Default Port |
|---------|---------|--------------|
| [Radarr](https://radarr.video) | Movie management | 7878 |
| [Sonarr](https://sonarr.tv) | TV series management | 8989 |
| [Prowlarr](https://prowlarr.com) | Indexer management | 9696 |
| [Bazarr](https://bazarr.media) | Subtitle management | 6767 |
| [qBittorrent](https://qbittorrent.org) | Torrent client | 8080 |
| [Emby](https://emby.media) / [Jellyfin](https://jellyfin.org) | Media server | 8096 |

## Example Commands (via WhatsApp)

```
"Download Breaking Bad"           → Sonarr adds it
"Get the movie Dune"              → Radarr adds it
"How are my downloads?"           → qBittorrent status
"How much disk space?"            → df -h output
"Add Spanish subs to Breaking Bad S01E01" → Bazarr/manual
"Refresh Emby library"            → API call to Emby
```

## Getting API Keys

**Sonarr/Radarr/Prowlarr:**
```bash
# From config files:
grep -oP '(?<=<ApiKey>)[^<]+' /opt/appdata/sonarr/config.xml
grep -oP '(?<=<ApiKey>)[^<]+' /opt/appdata/radarr/config.xml
```

**Emby:**
Dashboard → API Keys → New API Key

## Subtitle Translation Script

Included helper for translating English SRT to Spanish using Google Translate API (no key needed):

```bash
# scripts/translate-srt.py
python3 scripts/translate-srt.py input.en.srt output.es.srt
```

## emby-guard (Pause Downloads While Streaming)

Automatically pauses qBittorrent when Emby is actively streaming:

```bash
sudo cp emby-guard.service /etc/systemd/system/
sudo systemctl enable --now emby-guard
```

## Quality Profiles

Recommended Sonarr/Radarr quality profile:
- 1080p WEB-DL (preferred)
- 1080p Bluray
- 4K WEB-DL (if storage allows)
- Avoid: CAM, TS, HDRip
