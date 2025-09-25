#!/bin/bash
solana program dump -u m DwawFVKLnxwuwewJEDs7pcQJU3cXXYg2Z9DhRkXDmZ5S target/deploy/mpl_core.so
COPYFILE_DISABLE=1 solana-test-validator --bpf-program DwawFVKLnxwuwewJEDs7pcQJU3cXXYg2Z9DhRkXDmZ5S target/deploy/mpl_core.so --rpc-port 8899 --reset