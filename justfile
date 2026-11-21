# Commands are grouped by environment, and they work from anywhere in the repo:
# `just local` lists local development (local/justfile), `just aws` the web
# evaluator in AgentCore (aws/justfile).
mod local
mod aws

[private]
[default]
help:
    @just --list --list-submodules --unsorted
