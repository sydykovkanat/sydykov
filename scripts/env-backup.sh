#!/bin/bash

# Helper script to backup .env file from VPS
# This is useful for syncing GitHub Secret ENV_FILE with current VPS state
# Usage: ./scripts/env-backup.sh [save|print]

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# You can override these with environment variables
VPS_HOST="${VPS_HOST:-}"
VPS_USERNAME="${VPS_USERNAME:-}"
VPS_PORT="${VPS_PORT:-22}"
APP_DIR="${APP_DIR:-sydykov}"

show_help() {
  echo -e "${BLUE}ENV Backup - Get .env from VPS${NC}"
  echo ""
  echo "Usage:"
  echo "  ./scripts/env-backup.sh [command]"
  echo ""
  echo "Commands:"
  echo "  print    Print .env to stdout (default)"
  echo "  save     Save to .env.backup file"
  echo "  help     Show this help"
  echo ""
  echo "Environment variables:"
  echo "  VPS_HOST       VPS hostname or IP"
  echo "  VPS_USERNAME   SSH username"
  echo "  VPS_PORT       SSH port (default: 22)"
  echo "  APP_DIR        App directory on VPS (default: sydykov)"
  echo ""
  echo "Examples:"
  echo "  # Print to stdout (copy to GitHub Secret)"
  echo "  ./scripts/env-backup.sh"
  echo ""
  echo "  # Save to file"
  echo "  ./scripts/env-backup.sh save"
  echo ""
  echo "  # With custom host"
  echo "  VPS_HOST=123.45.67.89 VPS_USERNAME=root ./scripts/env-backup.sh"
  echo ""
}

check_config() {
  if [ -z "$VPS_HOST" ] || [ -z "$VPS_USERNAME" ]; then
    echo -e "${RED}❌ Error: VPS_HOST and VPS_USERNAME are required${NC}"
    echo ""
    echo "Set them as environment variables:"
    echo -e "${YELLOW}  VPS_HOST=your-vps-ip VPS_USERNAME=root ./scripts/env-backup.sh${NC}"
    echo ""
    echo "Or add them to your shell profile:"
    echo -e "${YELLOW}  export VPS_HOST=your-vps-ip${NC}"
    echo -e "${YELLOW}  export VPS_USERNAME=root${NC}"
    exit 1
  fi
}

print_env() {
  check_config

  echo -e "${BLUE}📥 Fetching .env from VPS...${NC}" >&2
  echo -e "${YELLOW}Host: $VPS_USERNAME@$VPS_HOST:$VPS_PORT${NC}" >&2
  echo -e "${YELLOW}Path: ~/$APP_DIR/.env${NC}" >&2
  echo "" >&2

  # Fetch .env from VPS
  if ssh -p "$VPS_PORT" "$VPS_USERNAME@$VPS_HOST" "cat ~/$APP_DIR/.env" 2>/dev/null; then
    echo "" >&2
    echo -e "${GREEN}✅ Successfully fetched .env from VPS${NC}" >&2
    echo -e "${BLUE}💡 Copy the output above and paste into GitHub Secret ENV_FILE${NC}" >&2
  else
    echo "" >&2
    echo -e "${RED}❌ Failed to fetch .env from VPS${NC}" >&2
    echo -e "${YELLOW}Make sure:${NC}" >&2
    echo "  1. VPS connection works: ssh -p $VPS_PORT $VPS_USERNAME@$VPS_HOST" >&2
    echo "  2. .env file exists: ssh -p $VPS_PORT $VPS_USERNAME@$VPS_HOST 'ls -la ~/$APP_DIR/.env'" >&2
    exit 1
  fi
}

save_env() {
  check_config

  timestamp=$(date +%Y%m%d_%H%M%S)
  backup_file=".env.backup.$timestamp"

  echo -e "${BLUE}📥 Fetching .env from VPS...${NC}"
  echo -e "${YELLOW}Host: $VPS_USERNAME@$VPS_HOST:$VPS_PORT${NC}"
  echo -e "${YELLOW}Path: ~/$APP_DIR/.env${NC}"
  echo ""

  # Fetch and save .env from VPS
  if ssh -p "$VPS_PORT" "$VPS_USERNAME@$VPS_HOST" "cat ~/$APP_DIR/.env" > "$backup_file" 2>/dev/null; then
    echo -e "${GREEN}✅ Backup saved to: $backup_file${NC}"
    echo ""
    echo -e "${BLUE}💡 To update GitHub Secret:${NC}"
    echo "  1. Go to: Settings → Secrets and variables → Actions"
    echo "  2. Edit ENV_FILE secret"
    echo "  3. Copy content: cat $backup_file"
  else
    rm -f "$backup_file"
    echo -e "${RED}❌ Failed to fetch .env from VPS${NC}"
    echo -e "${YELLOW}Make sure:${NC}"
    echo "  1. VPS connection works: ssh -p $VPS_PORT $VPS_USERNAME@$VPS_HOST"
    echo "  2. .env file exists: ssh -p $VPS_PORT $VPS_USERNAME@$VPS_HOST 'ls -la ~/$APP_DIR/.env'"
    exit 1
  fi
}

# Main
case "${1:-print}" in
  print)
    print_env
    ;;
  save)
    save_env
    ;;
  help|--help|-h)
    show_help
    ;;
  *)
    echo -e "${RED}Unknown command: $1${NC}"
    echo ""
    show_help
    exit 1
    ;;
esac
