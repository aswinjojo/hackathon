import os
import json
import asyncio
import msgpack
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths to both JSON files
ALL_JOBS_PATH = os.path.join(os.path.dirname(__file__), "data", "ercot_grid_rl_synthetic_trace_all_jobs.json")
RL_MIN_INSTABILITY_PATH = os.path.join(os.path.dirname(__file__), "data", "ercot_grid_rl_synthetic_trace_rl_min_instability.json")

def load_and_merge_data():
    """Load both JSON files and merge them by timestep"""
    # Load both files
    with open(ALL_JOBS_PATH, "r") as f:
        all_jobs_data = json.load(f)
    
    with open(RL_MIN_INSTABILITY_PATH, "r") as f:
        rl_min_data = json.load(f)
    
    # Get all unique timesteps from both files
    all_timesteps = set()
    all_timesteps.update(all_jobs_data.keys())
    all_timesteps.update(rl_min_data.keys())
    
    # Sort timesteps
    sorted_timesteps = sorted([int(ts) for ts in all_timesteps])
    
    # Create merged records
    merged_records = []
    for timestep in sorted_timesteps:
        ts_str = str(timestep)
        
        # Get records from both files (if available)
        all_jobs_record = all_jobs_data.get(ts_str)
        rl_min_record = rl_min_data.get(ts_str)
        
        # Use the first available record, or combine if both exist
        # For now, we'll alternate or use all_jobs first, then rl_min
        if all_jobs_record:
            merged_records.append({
                "source": "all_jobs",
                "timestep": timestep,
                "record": all_jobs_record
            })
        if rl_min_record:
            merged_records.append({
                "source": "rl_min_instability",
                "timestep": timestep,
                "record": rl_min_record
            })
    
    return merged_records

def map_record_to_payload(record_data, timestep, source):
    """Map JSON record to the expected payload format"""
    # Map fields from JSON structure to payload
    # Based on actual data ranges:
    # - jobs_pending: 0 to 253
    # - trace_it_power_mw: 0.19 to 6.29 MW
    
    # power_queue: use jobs_pending normalized (max observed: 253, use 300 as safe max)
    jobs_pending = record_data.get("jobs_pending", 0)
    power_queue = min(jobs_pending / 300.0, 1.0)
    
    # power_exec: use trace_it_power_mw normalized (max observed: 6.29, use 10 as safe max)
    trace_power = record_data.get("trace_it_power_mw", 0.0)
    power_exec = min(trace_power / 10.0, 1.0)
    
    # power_limit: use 1.0 as default
    power_limit = 1.0
    
    # Energy metrics in MW (actual values, not normalized)
    trace_it_power_mw = record_data.get("trace_it_power_mw", 0.0)
    renewable_power_mw = record_data.get("renewable_power_mw", 0.0)
    grid_import_mw = record_data.get("grid_import_mw", 0.0)
    battery_power_mw = record_data.get("battery_power_mw", 0.0)
    flywheel_power_mw = record_data.get("flywheel_power_mw", 0.0)
    data_center_total_power_mw = record_data.get("data_center_total_power_mw", 0.0)
    
    # Battery and Flywheel State of Charge (fraction 0-1)
    battery_soc_frac = record_data.get("battery_soc_frac", 0.0)
    flywheel_soc_frac = record_data.get("flywheel_soc_frac", 0.0)
    
    # Accumulated CO2 emissions in kg
    accum_co2_kg = record_data.get("accum_co2_kg", 0.0)
    
    # Grid stability metrics
    instability_index = record_data.get("instability_index", 0.0)
    grid_frequency_hz = record_data.get("grid_frequency_hz", 60.0)
    
    return {
        "timestep": timestep,
        "source": source,  # Add source identifier
        "pending_jobs_state": [],
        "executing_jobs_state": [],
        "power_queue": power_queue,
        "power_exec": power_exec,
        "power_limit": power_limit,
        # Energy metrics in MW
        "trace_it_power_mw": trace_it_power_mw,
        "renewable_power_mw": renewable_power_mw,
        "grid_import_mw": grid_import_mw,
        "battery_power_mw": battery_power_mw,
        "flywheel_power_mw": flywheel_power_mw,
        "data_center_total_power_mw": data_center_total_power_mw,
        # State of Charge fractions
        "battery_soc_frac": battery_soc_frac,
        "flywheel_soc_frac": flywheel_soc_frac,
        # Environmental metrics
        "accum_co2_kg": accum_co2_kg,
        # Grid stability metrics
        "instability_index": instability_index,
        "grid_frequency_hz": grid_frequency_hz,
    }

@app.websocket("/stream")
async def stream(ws: WebSocket):
    await ws.accept()

    try:
        # Load and merge data from both files
        merged_records = load_and_merge_data()
        
        print(f"Loaded {len(merged_records)} records from both files")
        
        # Stream each record
        for item in merged_records:
            payload = map_record_to_payload(item["record"], item["timestep"], item["source"])
            
            packed = msgpack.packb(payload, use_bin_type=True)
            await ws.send_bytes(packed)
            
            # ⏱ wait 0.1 seconds (100ms) to send 10 data points per second
            await asyncio.sleep(0.1)
        
        # When all records are sent
        await ws.send_bytes(msgpack.packb({"complete": True}, use_bin_type=True))

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Streaming error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        try:
            await ws.close()
        except:
            pass
