# Commands are grouped by environment. Local development lives in local/justfile:
# `just local` lists its commands, and they work from anywhere in the repo.
mod local

[private]
[default]
help:
    @just --list --list-submodules --unsorted
