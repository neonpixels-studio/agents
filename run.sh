#!/usr/bin/env bash

direnv exec . claude -p "Process Github issues and delegate to subagents" --dangerously-skip-permissions --output-format stream-json --verbose
