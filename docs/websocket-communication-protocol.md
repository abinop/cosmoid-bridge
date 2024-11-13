# WebSocket Communication Protocol Documentation

## Overview
This document outlines the WebSocket communication protocol used between the server and clients. The protocol is designed to handle real-time communication for various operations including chat messages, user status updates, and system notifications.

## Connection Details
- WebSocket Server URL: `ws://localhost:8080`
- Protocol: WebSocket (ws://)
- Default Port: 8080

## Message Format
All messages are exchanged in JSON format with the following base structure: 