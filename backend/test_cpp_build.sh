#!/bin/bash
# Simple test to verify C++ compilation works

echo "Testing C++ game engine compilation..."

cd ../game_engine

# Compile the bindings
g++ -std=c++17 -c -I./include src/game_bindings.cpp -o /tmp/game_bindings.o

if [ $? -eq 0 ]; then
    echo "✅ C++ bindings compiled successfully!"
    echo "   Object file: /tmp/game_bindings.o"
    ls -lh /tmp/game_bindings.o
else
    echo "❌ C++ compilation failed"
    exit 1
fi

echo ""
echo "All C++ compilation tests passed!"
echo "Once you fix the cargo cache issue, run: cargo build"
