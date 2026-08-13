#!/usr/bin/env sh
set -eu

PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

php -l "$PLUGIN_DIR/oneclick-siteforge-runtime.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-validation.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-assets.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-transactions.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-rest-controller.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-v3-state.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-v3-validation.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-v3-assets.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-v3-materializer.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-v3-transactions.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-v3-rest-controller.php"
php -l "$PLUGIN_DIR/tests/run.php"
php "$PLUGIN_DIR/tests/run.php"
node "$PLUGIN_DIR/tests/static.mjs"

