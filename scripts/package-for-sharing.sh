#!/bin/bash
# Bash script to package the app for sharing
# This creates a ZIP file excluding node_modules, .next, and sensitive files

echo "Packaging Kasa Family Management for sharing..."

PROJECT_PATH="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_PATH="$(dirname "$PROJECT_PATH")/kasa-family-management-share.zip"

# Create temporary directory
TEMP_DIR=$(mktemp -d)
echo "Using temp directory: $TEMP_DIR"

# Copy files excluding specified items
cd "$PROJECT_PATH"
rsync -av --progress \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.vercel' \
  --exclude='.env*' \
  --exclude='*.log' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='build' \
  . "$TEMP_DIR/"

# Create ZIP file
cd "$TEMP_DIR"
zip -r "$OUTPUT_PATH" . -q

# Clean up
rm -rf "$TEMP_DIR"

echo ""
echo "Package created successfully!"
echo "Location: $OUTPUT_PATH"
echo ""
echo "Next steps:"
echo "1. Share this ZIP file with the recipient"
echo "2. Include SETUP_INSTRUCTIONS.md (it's in the package)"
echo "3. Make sure they have Node.js 18+ installed"

