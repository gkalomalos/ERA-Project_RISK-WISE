# Changelog

All notable changes to this project will be documented in this file.  
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/).

## Unreleased

## 1.0.9 - 2026-06-03

### Changed

- Decoupled the engine download from app release tags using a dedicated `engine-v1` release
- Switched the Leaflet basemap from OpenStreetMap to Carto Voyager
- Updated application and security dependencies

### Fixed

- Corrected `cred_output` macroeconomic data and removed `government_debt`
- Hardened Python IPC parsing and tightened the Electron preload bridge
- Improved reliability of the startup and progress loader
- Fixed several scenario runner and base handler bugs

## 1.0.8 - 2025-12-17

### Added

- Informative loader messages during application startup
- Progress indicators for engine download and installation
- Status updates for engine initialization and temporary file cleanup
- Automatic engine download and installation for portable version users
- Support for ZIP and 7Z portable distribution formats

### Changed

- Enhanced loading screen with real-time status updates
- Improved user feedback during engine setup process

### Fixed

- Loader window overflow and scrollbar issues
- Engine detection and installation flow for portable versions

## 1.0.7 - 2025-12-15

### Added

- Split application and engine installation process
- Separate engine installation to preserve user data across updates
- Reuse of downloaded engine archive to save bandwidth
- New Windows installation process with modular engine setup

### Changed

- Split application data into immutable and persistent paths
- Updated security and application dependencies

### Fixed

- Removed Windows code-sign disable flags to fix Electron icon fallback issue

## 1.0.6 - 2025-12-14

### Changed

- Split application and engine installation architecture

## 1.0.5 - 2025-12-13

### Added

- Centralized logging system with unified log directory
- Safer startup flow with comprehensive error handling
- Process-level safeguards for application lifecycle
- New application release workflow for GitHub Actions
- Updated `.gitignore` with environment and development exclusions

### Changed

- Redefined `electron.js` with improved backend lifecycle management
- Backend now uses `LOG_DIR` environment variable for unified logging
- Disabled code signing in `package.json` configuration
- Updated NSIS configuration to x64 architecture only

### Fixed

- Application startup reliability and error recovery
