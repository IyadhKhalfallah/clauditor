# Changelog

## [1.2.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.1.3...v1.2.0) (2026-04-02)


### Features

* add SessionStart hook, repeated-edit detector, and richer KPIs ([f745248](https://github.com/IyadhKhalfallah/clauditor/commit/f745248e335fbbb886c377fd1b06fd7431ca3836))
* auto-save session context to CLAUDE.md before compaction ([0d62984](https://github.com/IyadhKhalfallah/clauditor/commit/0d62984c05728be191fb3cd4b0eed5a23ba42dfe))
* richer impact KPIs — all provable from JSONL data ([6bb52bf](https://github.com/IyadhKhalfallah/clauditor/commit/6bb52bff8639adcb430d38de5091e019b4ce6e1c))
* show subagent task description instead of cryptic IDs ([dd2e8e5](https://github.com/IyadhKhalfallah/clauditor/commit/dd2e8e5be9412e1db132f83c006264abaa6724b3))


### Bug Fixes

* include subagent ID in parentheses before task description ([2f8f2d5](https://github.com/IyadhKhalfallah/clauditor/commit/2f8f2d599946f1aefef99c17a889863353b8047a))

## [1.1.3](https://github.com/IyadhKhalfallah/clauditor/compare/v1.1.2...v1.1.3) (2026-04-02)


### Bug Fixes

* enable polling mode for file watching — FSEvents unreliable on macOS ([874c403](https://github.com/IyadhKhalfallah/clauditor/commit/874c4039f681abddfee6f48485abf17948032367))
* only flag burn rate when cache is also degraded ([4941803](https://github.com/IyadhKhalfallah/clauditor/commit/494180380bcffc38c60def15999970559a57a0f6))
* watch directory directly instead of glob — chokidar v4 glob broken ([8680917](https://github.com/IyadhKhalfallah/clauditor/commit/868091758c9661121b07aabc814145d22e9f8520))

## [1.1.2](https://github.com/IyadhKhalfallah/clauditor/compare/v1.1.1...v1.1.2) (2026-04-02)


### Bug Fixes

* clear terminal before Ink renders to prevent duplicate frames ([e6933b8](https://github.com/IyadhKhalfallah/clauditor/commit/e6933b8bfd68555acbf66fee7f4c4f745b87f3f3))
* clear terminal on TUI mount to prevent duplicate rendering ([0678a9e](https://github.com/IyadhKhalfallah/clauditor/commit/0678a9e25b658abfdae7fc7f8a3bc36336a42076))
* use platform-aware path handling for Windows compatibility ([ac778d2](https://github.com/IyadhKhalfallah/clauditor/commit/ac778d2422f3ec25282cdd44209a5ff788546b6c))


### Performance Improvements

* incremental JSONL parsing — only read new lines on file change ([a941dbe](https://github.com/IyadhKhalfallah/clauditor/commit/a941dbe9cc7995b425ce696ccdbf8bd78547e052))

## [1.1.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.1.0...v1.1.1) (2026-04-02)


### Bug Fixes

* count degraded cache sessions in impact tracker, not just broken ([5001c18](https://github.com/IyadhKhalfallah/clauditor/commit/5001c180a5953649c5f12047535818fe00178e69))

## [1.1.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.0.3...v1.1.0) (2026-04-02)


### Features

* add activity log — track and display every action clauditor takes ([669806c](https://github.com/IyadhKhalfallah/clauditor/commit/669806c67031a14805e81fcd2f6b3749a0062a67))
* add impact tracker — lifetime KPIs across all sessions ([d9b2c51](https://github.com/IyadhKhalfallah/clauditor/commit/d9b2c514539c9e6098c04d0f4131d3202ff3dc28))

## [1.0.3](https://github.com/IyadhKhalfallah/clauditor/compare/v1.0.2...v1.0.3) (2026-04-02)


### Bug Fixes

* remove unreliable time estimates, label cost as API-only ([fbd912d](https://github.com/IyadhKhalfallah/clauditor/commit/fbd912d9db6fca84be0ef4a207577e2ad2b45818))

## [1.0.2](https://github.com/IyadhKhalfallah/clauditor/compare/v1.0.1...v1.0.2) (2026-04-02)


### Bug Fixes

* model-aware context limits and smarter burn rate classification ([47c70a4](https://github.com/IyadhKhalfallah/clauditor/commit/47c70a402e213843109f54281b1412006290d59a))
* wire up q key and ctrl+c to quit the TUI ([39159d3](https://github.com/IyadhKhalfallah/clauditor/commit/39159d333424465dd2d7e34b60040aa0298fb8c4))

## [1.0.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.0.0...v1.0.1) (2026-04-02)


### Bug Fixes

* read version from package.json instead of hardcoding ([0ee518c](https://github.com/IyadhKhalfallah/clauditor/commit/0ee518ca44c346222c30c1da54a445c486d9ac1d))

## 1.0.0 (2026-04-02)


### Features

* add resume anomaly detection, quota burn rate, and quota-aware memory audit ([0df13b8](https://github.com/IyadhKhalfallah/clauditor/commit/0df13b84ec62c286fe1b67abe518ed2b4254ff22))
* create clauditor — session health monitoring for Claude Code ([e59ba78](https://github.com/IyadhKhalfallah/clauditor/commit/e59ba784fda5f8917d17b8ed4cc268a6c93dd0f3))
