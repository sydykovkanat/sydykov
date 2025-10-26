#!/bin/bash

# Helper script for managing environment variables
# Usage: ./scripts/env-helper.sh [command]

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ENV_FILE=".env"
EXAMPLE_FILE=".env.example"

show_help() {
  echo -e "${BLUE}ENV Helper - Manage environment variables${NC}"
  echo ""
  echo "Commands:"
  echo "  check         Check if all required env variables are set"
  echo "  diff          Show differences between .env and .env.example"
  echo "  copy          Copy .env.example to .env (interactive)"
  echo "  validate      Validate .env format"
  echo "  backup        Backup current .env file"
  echo "  help          Show this help message"
  echo ""
}

check_env() {
  echo -e "${BLUE}Checking environment variables...${NC}"

  if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}❌ .env file not found${NC}"
    echo -e "${YELLOW}Run: cp .env.example .env${NC}"
    exit 1
  fi

  # Extract variable names from .env.example
  required_vars=$(grep -v '^#' "$EXAMPLE_FILE" | grep '=' | cut -d '=' -f1 | grep -v '^$')

  missing_vars=()
  empty_vars=()

  while IFS= read -r var; do
    if ! grep -q "^$var=" "$ENV_FILE"; then
      missing_vars+=("$var")
    else
      value=$(grep "^$var=" "$ENV_FILE" | cut -d '=' -f2-)
      if [ -z "$value" ]; then
        empty_vars+=("$var")
      fi
    fi
  done <<< "$required_vars"

  if [ ${#missing_vars[@]} -eq 0 ] && [ ${#empty_vars[@]} -eq 0 ]; then
    echo -e "${GREEN}✅ All required variables are set${NC}"
    return 0
  fi

  if [ ${#missing_vars[@]} -gt 0 ]; then
    echo -e "${RED}❌ Missing variables:${NC}"
    printf '  %s\n' "${missing_vars[@]}"
  fi

  if [ ${#empty_vars[@]} -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Empty variables:${NC}"
    printf '  %s\n' "${empty_vars[@]}"
  fi

  exit 1
}

diff_env() {
  echo -e "${BLUE}Comparing .env with .env.example...${NC}"

  if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}❌ .env file not found${NC}"
    exit 1
  fi

  example_vars=$(grep -v '^#' "$EXAMPLE_FILE" | grep '=' | cut -d '=' -f1 | sort)
  current_vars=$(grep -v '^#' "$ENV_FILE" | grep '=' | cut -d '=' -f1 | sort)

  echo -e "${GREEN}Variables in .env.example but not in .env:${NC}"
  comm -23 <(echo "$example_vars") <(echo "$current_vars") || echo "  (none)"

  echo ""
  echo -e "${YELLOW}Variables in .env but not in .env.example:${NC}"
  comm -13 <(echo "$example_vars") <(echo "$current_vars") || echo "  (none)"
}

copy_env() {
  if [ -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}⚠️  .env file already exists${NC}"
    read -p "Overwrite? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Cancelled"
      exit 0
    fi
  fi

  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo -e "${GREEN}✅ Created .env from .env.example${NC}"
  echo -e "${YELLOW}Don't forget to fill in your actual values!${NC}"
}

validate_env() {
  echo -e "${BLUE}Validating .env format...${NC}"

  if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}❌ .env file not found${NC}"
    exit 1
  fi

  line_num=0
  errors=0

  while IFS= read -r line; do
    ((line_num++))

    # Skip empty lines and comments
    if [[ -z "$line" ]] || [[ "$line" =~ ^[[:space:]]*# ]]; then
      continue
    fi

    # Check for valid format
    if ! [[ "$line" =~ ^[A-Z_][A-Z0-9_]*= ]]; then
      echo -e "${RED}❌ Line $line_num: Invalid format${NC}"
      echo "   $line"
      ((errors++))
    fi
  done < "$ENV_FILE"

  if [ $errors -eq 0 ]; then
    echo -e "${GREEN}✅ .env format is valid${NC}"
  else
    echo -e "${RED}❌ Found $errors error(s)${NC}"
    exit 1
  fi
}

backup_env() {
  if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}❌ .env file not found${NC}"
    exit 1
  fi

  timestamp=$(date +%Y%m%d_%H%M%S)
  backup_file=".env.backup.$timestamp"

  cp "$ENV_FILE" "$backup_file"
  echo -e "${GREEN}✅ Backup created: $backup_file${NC}"
}

# Main
case "${1:-help}" in
  check)
    check_env
    ;;
  diff)
    diff_env
    ;;
  copy)
    copy_env
    ;;
  validate)
    validate_env
    ;;
  backup)
    backup_env
    ;;
  help)
    show_help
    ;;
  *)
    echo -e "${RED}Unknown command: $1${NC}"
    echo ""
    show_help
    exit 1
    ;;
esac
