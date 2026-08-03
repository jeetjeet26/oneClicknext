#!/usr/bin/env sh
set -eu

PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

php -l "$PLUGIN_DIR/oneclick-siteforge-runtime.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-validation.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-assets.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-transactions.php"
php -l "$PLUGIN_DIR/includes/class-siteforge-runtime-rest-controller.php"
php -l "$PLUGIN_DIR/tests/run.php"
php "$PLUGIN_DIR/tests/run.php"

