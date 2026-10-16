# Live Collaborative Workspace

A multi-user real-time web workspace where students can join persistent virtual rooms, collaborate on code simultaneously, and track presence without data collisions or UI freezing.

## Features

- **Synchronized Editor:** Split layout featuring real-time code updates, line highlighting, and cursor tracking.
- **Room Management & Security:** Custom room IDs secured with optional passcodes, verified before granting admission.
- **Real-Time Synchronization:** Live character insertions/deletions, cursor coordinates, and typing badges.
- **Connection & Spam Throttling:** Client debounce (250ms) and strict server-side throttling (>5 updates/second) to prevent socket flooding.
- **Dynamic Role Migration:** Automatic promotion of the oldest active member to host upon host disconnection.

## Prerequisites

- Node.js (v18+)
- Python (v3.9+)

## Setup and Installation

### 1. Backend Server
Navigate to the server directory, install the required packages, and run the ASGI server:

```bash
cd server
pip install -r requirements.txt
python main.py
