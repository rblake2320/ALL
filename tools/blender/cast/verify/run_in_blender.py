"""Run verify_cast.py inside a stock Blender.

verify_cast.py reads sys.argv itself (it was written for a Python venv with the `bpy` module). A stock Blender
puts its own arguments first and the script's after `--`, so this passes those on:

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/cast/verify/run_in_blender.py -- \
        --out DIR [--assets public/assets] [--only a,b] [--no-render]

Run it from the project root.
"""
import os
import runpy
import sys

sys.argv = ['verify_cast.py'] + sys.argv[sys.argv.index('--') + 1:]
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'verify_cast.py'), run_name='__main__')
