#!/usr/bin/env bash

claude -p "Process Github issues and delegate to subagents" \
  --dangerously-skip-permissions \
  --output-format stream-json
