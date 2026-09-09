name: Build Desktop Apps

on:
  push:
    branches: [main, master]
  workflow_dispatch:

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 60

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js 24
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Clear npm cache
        run: npm cache clean --force

      - name: Install dependencies
        run: npm install --legacy-peer-deps
        timeout-minutes: 30

      - name: Build app
        run: npm run build
        timeout-minutes: 30
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload artifacts (Linux)
        if: matrix.os == 'ubuntu-latest' && success()
        uses: actions/upload-artifact@v4
        with:
          name: workspace-sk-editor2-linux
          path: dist/electron/*.AppImage
          retention-days: 30

      - name: Upload artifacts (Windows)
        if: matrix.os == 'windows-latest' && success()
        uses: actions/upload-artifact@v4
        with:
          name: workspace-sk-editor2-windows
          path: dist/electron/*.exe
          retention-days: 30

      - name: Upload artifacts (Mac)
        if: matrix.os == 'macos-latest' && success()
        uses: actions/upload-artifact@v4
        with:
          name: workspace-sk-editor2-mac
          path: dist/electron/*.dmg
          retention-days: 30

      - name: Upload logs on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: build-logs-${{ matrix.os }}
          path: |
            npm-debug.log
            dist/
          retention-days: 30
