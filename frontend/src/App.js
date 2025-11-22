import React, { useEffect, useState, useRef, useMemo } from "react";
import { decode } from "@msgpack/msgpack";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  ComposedChart,
  BarChart,
  Bar,
} from "recharts";
import "./App.css";

function App() {
  const [status, setStatus] = useState("Connecting...");
  const [timestep, setTimestep] = useState(null);
  const [power, setPower] = useState(null);
  const [log, setLog] = useState([]);
  const [chartDataAllJobs, setChartDataAllJobs] = useState([]);
  const [chartDataRlMin, setChartDataRlMin] = useState([]);
  const [batterySOC, setBatterySOC] = useState(null);
  const [flywheelSOC, setFlywheelSOC] = useState(null);
  const [energyConsumed, setEnergyConsumed] = useState(null); // Energy consumed in MW
  const [maxCO2, setMaxCO2] = useState(0); // Track max CO2 for relative scaling
  const [gridStabilityDataAllJobs, setGridStabilityDataAllJobs] = useState([]); // Grid stability metrics for all_jobs
  const [gridStabilityDataRlMin, setGridStabilityDataRlMin] = useState([]); // Grid stability metrics for rl_min_instability
  const maxDataPoints = 100; // Keep last 100 data points for smooth visualization

  const logRef = useRef(null);

  // Format number with K, M, B suffixes
  const formatNumber = (num) => {
    if (num >= 1000000000) {
      return (num / 1000000000).toFixed(2) + "B";
    } else if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + "M";
    } else if (num >= 1000) {
      return (num / 1000).toFixed(2) + "K";
    } else {
      return num.toFixed(1);
    }
  };

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:8000/stream");
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      console.log("Connected to backend");
      setStatus("Connected");
    };

    socket.onmessage = (event) => {
      try {
        const data = decode(new Uint8Array(event.data));

        // completion message
        if (data.complete) {
          setStatus("Completed");
          return;
        }

        // Debug: log received data (only first few to avoid spam)
        if ((chartDataAllJobs.length + chartDataRlMin.length) < 5) {
          console.log("Received data:", data);
        }

        // Check if source field exists
        if (!data.source) {
          console.warn("Missing source field in data:", data);
        }

        // update UI
        setTimestep(data.timestep);
        setPower({
          queue: data.power_queue,
          exec: data.power_exec,
          limit: data.power_limit,
        });
        
        // Update battery and flywheel SOC for RL Min Instability source
        if (data.source === "rl_min_instability") {
          setBatterySOC(data.battery_soc_frac);
          setFlywheelSOC(data.flywheel_soc_frac);
        }
        
        // Update energy consumed (data center total power) for both sources
        if (data.data_center_total_power_mw !== undefined) {
          setEnergyConsumed(data.data_center_total_power_mw);
        }

        // Add to chart data based on source
        // Ensure all values are numbers
        const chartDataPoint = {
          timestep: Number(data.timestep),
          power_exec: Number(data.power_exec) || 0,
          power_queue: Number(data.power_queue) || 0,
          power_limit: Number(data.power_limit) || 1.0,
          // Energy metrics in MW
          trace_it_power_mw: Number(data.trace_it_power_mw) || 0,
          renewable_power_mw: Number(data.renewable_power_mw) || 0,
          grid_import_mw: Number(data.grid_import_mw) || 0,
          battery_power_mw: Number(data.battery_power_mw) || 0,
          flywheel_power_mw: Number(data.flywheel_power_mw) || 0,
          data_center_total_power_mw: Number(data.data_center_total_power_mw) || 0,
          // Environmental metrics
          accum_co2_kg: Number(data.accum_co2_kg) || 0,
          // Grid stability metrics
          instability_index: Number(data.instability_index) || 0,
          grid_frequency_hz: Number(data.grid_frequency_hz) || 60.0,
        };

        // Ensure we have valid numeric values
        if (isNaN(chartDataPoint.power_exec) || 
            isNaN(chartDataPoint.power_queue) ||
            isNaN(chartDataPoint.timestep) ||
            isNaN(chartDataPoint.grid_import_mw) ||
            isNaN(chartDataPoint.renewable_power_mw) ||
            isNaN(chartDataPoint.battery_power_mw) ||
            isNaN(chartDataPoint.flywheel_power_mw)) {
          console.warn("Invalid data point (NaN):", chartDataPoint, "Original data:", data);
          return;
        }

        if (data.source === "all_jobs") {
          setChartDataAllJobs((prev) => {
            const newData = [...prev, chartDataPoint];
            const result = newData.slice(-maxDataPoints);
            // Debug: log first few data points
            if (result.length <= 3) {
              console.log("All Jobs chart data:", result);
            }
            return result;
          });
        } else if (data.source === "rl_min_instability") {
          setChartDataRlMin((prev) => {
            const newData = [...prev, chartDataPoint];
            const result = newData.slice(-maxDataPoints);
            // Debug: log first few data points
            if (result.length <= 3) {
              console.log("RL Min chart data:", result);
            }
            return result;
          });
        } else {
          console.warn("Unknown or missing source:", data.source, "Data:", data);
          // Fallback: if source is missing, try to add to both or default to all_jobs
          if (!data.source) {
            console.warn("Source field missing, defaulting to all_jobs");
            setChartDataAllJobs((prev) => {
              const newData = [...prev, chartDataPoint];
              return newData.slice(-maxDataPoints);
            });
          }
        }

        // Update grid stability data based on source
        if (data.instability_index !== undefined && data.grid_frequency_hz !== undefined) {
          const newDataPoint = {
            timestep: Number(data.timestep),
            instability_index: Number(data.instability_index) || 0,
            grid_frequency_hz: Number(data.grid_frequency_hz) || 60.0,
          };
          
          if (data.source === "all_jobs") {
            setGridStabilityDataAllJobs((prev) => {
              const newData = [...prev, newDataPoint];
              return newData.slice(-maxDataPoints);
            });
          } else if (data.source === "rl_min_instability") {
            setGridStabilityDataRlMin((prev) => {
              const newData = [...prev, newDataPoint];
              return newData.slice(-maxDataPoints);
            });
          }
        }

        // append to log
        const sourceLabel = data.source === "all_jobs" ? "All Jobs" : data.source === "rl_min_instability" ? "RL Min Instability" : "Unknown";
        setLog((prev) => [
          ...prev,
          `[${sourceLabel}] Timestep ${data.timestep} | Queue ${data.power_queue?.toFixed(
            4
          ) || 0} | Exec ${data.power_exec?.toFixed(4) || 0}`
        ]);

      } catch (err) {
        console.error("Decode error:", err);
        setLog((prev) => [...prev, `Error: ${err.message}`]);
      }
    };

    socket.onerror = () => {
      setStatus("Error");
    };

    socket.onclose = () => {
      setStatus("Disconnected");
    };

    // Cleanup
    return () => {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    };
  }, []);

  // Auto scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  // Calculate max CO2 from both charts for relative scaling
  // Find the maximum value across ALL data points in both charts
  useEffect(() => {
    let maxAllJobs = 0;
    let maxRlMin = 0;
    
    // Find max in all_jobs chart
    if (chartDataAllJobs.length > 0) {
      maxAllJobs = Math.max(...chartDataAllJobs.map(d => d.accum_co2_kg || 0));
    }
    
    // Find max in rl_min_instability chart
    if (chartDataRlMin.length > 0) {
      maxRlMin = Math.max(...chartDataRlMin.map(d => d.accum_co2_kg || 0));
    }
    
    // Use the maximum of both for relative scaling
    const currentMax = Math.max(maxAllJobs, maxRlMin);
    if (currentMax > 0) {
      setMaxCO2(currentMax);
    }
  }, [chartDataAllJobs, chartDataRlMin]);

  // Merge grid stability data for bar chart
  const mergedInstabilityData = useMemo(() => {
    const dataMap = new Map();
    
    // Add all_jobs data
    gridStabilityDataAllJobs.forEach(item => {
      dataMap.set(item.timestep, {
        timestep: item.timestep,
        allJobs: item.instability_index,
        rlMin: null,
      });
    });
    
    // Add or update with rl_min data
    gridStabilityDataRlMin.forEach(item => {
      const existing = dataMap.get(item.timestep);
      if (existing) {
        existing.rlMin = item.instability_index;
      } else {
        dataMap.set(item.timestep, {
          timestep: item.timestep,
          allJobs: null,
          rlMin: item.instability_index,
        });
      }
    });
    
    return Array.from(dataMap.values()).sort((a, b) => a.timestep - b.timestep);
  }, [gridStabilityDataAllJobs, gridStabilityDataRlMin]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>⚡ Real-Time Power Simulation Dashboard</h1>
        <div style={styles.headerRight}>
          <div style={styles.statusBox(status)}>
            <span style={styles.statusDot(status)}></span>
            <strong>Status:</strong> {status}
          </div>
          <div style={styles.dataCounter}>
            <strong>All Jobs:</strong> {chartDataAllJobs.length} | 
            <strong> RL Min:</strong> {chartDataRlMin.length}
          </div>
        </div>
      </div>

      {/* Current Metrics Cards */}
      <div style={styles.metricsGrid}>
        <div style={styles.metricCard}>
          <div style={styles.metricLabel}>Current Timestep</div>
          <div style={styles.metricValue}>{timestep ?? "---"}</div>
        </div>
      </div>

      {/* Side-by-Side Charts */}
      <div style={styles.chartsGrid} className="charts-grid">
        {/* All Jobs Chart - Left Side */}
        <div style={styles.chartContainer}>
          <div style={{ marginBottom: "20px" }}>
            <h2 style={styles.chartTitle}>
              All Jobs - Grid Import (MW)
              {chartDataAllJobs.length > 0 && (
                <span style={{ fontSize: "14px", color: "#6b7280", fontWeight: "normal" }}>
                  {" "}({chartDataAllJobs.length} points)
                </span>
              )}
            </h2>
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "flex-start", marginTop: "12px" }}>
              {chartDataAllJobs.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ ...styles.metricLabel, marginBottom: 0, textAlign: "center" }}>Accumulated CO₂</div>
                  <div style={styles.inlineMetricCard}>
                    <div style={{ ...styles.metricValue, color: "#ef4444", fontSize: "18px", textAlign: "center" }}>
                      {formatNumber(chartDataAllJobs[chartDataAllJobs.length - 1]?.accum_co2_kg || 0)} kg
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          {chartDataAllJobs.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <AreaChart
                data={chartDataAllJobs}
                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorGridImportAllJobs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="timestep"
                  stroke="#6b7280"
                  style={{ fontSize: "12px" }}
                />
                <YAxis
                  stroke="#6b7280"
                  style={{ fontSize: "12px" }}
                  label={{
                    value: "Power (MW)",
                    angle: -90,
                    position: "insideLeft",
                    style: { textAnchor: "middle", fill: "#6b7280" },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1f2937",
                    border: "none",
                    borderRadius: "8px",
                    color: "#f9fafb",
                  }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="grid_import_mw"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  fillOpacity={0.7}
                  fill="url(#colorGridImportAllJobs)"
                  name="Grid Import (MW)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={styles.chartPlaceholder}>
              Waiting for data...
            </div>
          )}
        </div>

        {/* RL Min Instability Chart - Right Side */}
        <div style={styles.chartContainer}>
          <div style={{ marginBottom: "20px" }}>
            <h2 style={styles.chartTitle}>
              RL Min Instability - Energy Ratio (MW)
              {chartDataRlMin.length > 0 && (
                <span style={{ fontSize: "14px", color: "#6b7280", fontWeight: "normal" }}>
                  {" "}({chartDataRlMin.length} points)
                </span>
              )}
            </h2>
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "20px", marginTop: "12px" }}>
              {chartDataRlMin.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ ...styles.metricLabel, marginBottom: 0, textAlign: "center" }}>Accumulated CO₂</div>
                  <div style={styles.inlineMetricCard}>
                    <div style={{ ...styles.metricValue, color: "#ef4444", fontSize: "18px", textAlign: "center" }}>
                      {formatNumber(chartDataRlMin[chartDataRlMin.length - 1]?.accum_co2_kg || 0)} kg
                    </div>
                  </div>
                </div>
              )}
              {/* Battery, Flywheel, and Energy Consumed Indicators */}
            <div style={styles.socIndicators}>
              {batterySOC !== null && (
                <div style={styles.socIndicator}>
                  <div style={styles.batteryIcon}>
                      <svg 
                        width="30" 
                        height="65" 
                        viewBox="0 0 30 65" 
                        style={{ display: "block" }}
                      >
                        {/* Battery terminal cap */}
                        <rect 
                          x="10" 
                          y="0" 
                          width="10" 
                          height="8" 
                          rx="2" 
                          fill="#000000"
                        />
                        
                        {/* Battery main body outline */}
                        <rect 
                          x="2" 
                          y="8" 
                          width="26" 
                          height="50" 
                          rx="4" 
                          fill="none"
                          stroke="#000000"
                          strokeWidth="2"
                        />
                        
                        {/* Five horizontal segments - fill based on SOC */}
                        {batterySOC > 0.8 && (
                          <rect 
                            x="4" 
                            y="54" 
                            width="22" 
                            height="2" 
                            rx="1" 
                            fill={batterySOC > 0.5 ? "#10b981" : batterySOC > 0.2 ? "#f59e0b" : "#ef4444"}
                          />
                        )}
                        {batterySOC > 0.6 && (
                          <rect 
                            x="4" 
                            y="50" 
                            width="22" 
                            height="2" 
                            rx="1" 
                            fill={batterySOC > 0.5 ? "#10b981" : batterySOC > 0.2 ? "#f59e0b" : "#ef4444"}
                          />
                        )}
                        {batterySOC > 0.4 && (
                          <rect 
                            x="4" 
                            y="46" 
                            width="22" 
                            height="2" 
                            rx="1" 
                            fill={batterySOC > 0.5 ? "#10b981" : batterySOC > 0.2 ? "#f59e0b" : "#ef4444"}
                          />
                        )}
                        {batterySOC > 0.2 && (
                          <rect 
                            x="4" 
                            y="42" 
                            width="22" 
                            height="2" 
                            rx="1" 
                            fill={batterySOC > 0.5 ? "#10b981" : batterySOC > 0.2 ? "#f59e0b" : "#ef4444"}
                          />
                        )}
                        {batterySOC > 0 && (
                          <rect 
                            x="4" 
                            y="38" 
                            width="22" 
                            height="2" 
                            rx="1" 
                            fill={batterySOC > 0.5 ? "#10b981" : batterySOC > 0.2 ? "#f59e0b" : "#ef4444"}
                          />
                        )}
                      </svg>
                  </div>
                  <span style={styles.socText}>{(batterySOC * 100).toFixed(1)}%</span>
                </div>
              )}
              {flywheelSOC !== null && (
                <div style={styles.socIndicator}>
                  <div style={styles.flywheelIcon}>
                    <svg 
                      width="50" 
                      height="50" 
                      viewBox="0 0 50 50" 
                      style={{ display: "block" }}
                    >
                      {/* White circle background */}
                      <circle 
                        cx="25" 
                        cy="25" 
                        r="20" 
                        fill="#ffffff"
                      />
                      
                      {/* Outer ring - unfilled portion (light grey) - full circle */}
                      <circle 
                        cx="25" 
                        cy="25" 
                        r="18" 
                        fill="none"
                        stroke="#d1d5db"
                        strokeWidth="4"
                      />
                      
                      {/* Outer ring - filled portion (lime green) - using stroke-dasharray */}
                      {(() => {
                        const radius = 18;
                        const circumference = 2 * Math.PI * radius;
                        const filledLength = circumference * flywheelSOC;
                        const gapLength = circumference - filledLength;
                        return (
                          <circle 
                            cx="25" 
                            cy="25" 
                            r={radius} 
                            fill="none"
                            stroke={flywheelSOC > 0.5 ? "#84cc16" : flywheelSOC > 0.2 ? "#f59e0b" : "#ef4444"}
                            strokeWidth="4"
                            strokeDasharray={`${filledLength} ${gapLength}`}
                            strokeDashoffset={circumference * 0.25}
                            transform="rotate(-90 25 25)"
                            strokeLinecap="round"
                          />
                        );
                      })()}
                      
                      {/* Central lightning bolt */}
                      <path 
                        d="M 25 15 L 20 25 L 23 25 L 22 35 L 30 20 L 27 20 Z" 
                        fill={flywheelSOC > 0.5 ? "#84cc16" : flywheelSOC > 0.2 ? "#f59e0b" : "#ef4444"}
                      />
                    </svg>
                  </div>
                  <span style={styles.socText}>{(flywheelSOC * 100).toFixed(1)}%</span>
                </div>
              )}
              </div>
            </div>
          </div>
          {chartDataRlMin.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <AreaChart
                data={chartDataRlMin}
                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorGridImportRlMin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.1} />
                  </linearGradient>
                  <linearGradient id="colorRenewableRlMin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
                  </linearGradient>
                  <linearGradient id="colorBatteryRlMin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                  </linearGradient>
                  <linearGradient id="colorFlywheelRlMin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="timestep"
                  stroke="#6b7280"
                  style={{ fontSize: "12px" }}
                />
                <YAxis
                  stroke="#6b7280"
                  style={{ fontSize: "12px" }}
                  label={{
                    value: "Power (MW)",
                    angle: -90,
                    position: "insideLeft",
                    style: { textAnchor: "middle", fill: "#6b7280" },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1f2937",
                    border: "none",
                    borderRadius: "8px",
                    color: "#f9fafb",
                  }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="grid_import_mw"
                  stroke="#ef4444"
                  strokeWidth={2}
                  fillOpacity={0.7}
                  fill="url(#colorGridImportRlMin)"
                  name="Grid Import (MW)"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="renewable_power_mw"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={0.7}
                  fill="url(#colorRenewableRlMin)"
                  name="Renewable Power (MW)"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="battery_power_mw"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fillOpacity={0.7}
                  fill="url(#colorBatteryRlMin)"
                  name="Battery Power (MW)"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="flywheel_power_mw"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fillOpacity={0.7}
                  fill="url(#colorFlywheelRlMin)"
                  name="Flywheel Power (MW)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={styles.chartPlaceholder}>
              Waiting for data...
            </div>
          )}
        </div>
      </div>

      {/* Grid Instability Index Bar Chart */}
      <div style={styles.chartContainer}>
        <h2 style={styles.chartTitle}>
          Grid Instability Index
          {mergedInstabilityData.length > 0 && (
            <span style={{ fontSize: "14px", color: "#6b7280", fontWeight: "normal" }}>
              {" "}({mergedInstabilityData.length} points)
            </span>
          )}
        </h2>
        {mergedInstabilityData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart
              data={mergedInstabilityData}
              margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="timestep"
                stroke="#6b7280"
                style={{ fontSize: "12px" }}
              />
              <YAxis
                stroke="#8b5cf6"
                style={{ fontSize: "12px" }}
                label={{
                  value: "Instability Index",
                  angle: -90,
                  position: "insideLeft",
                  style: { textAnchor: "middle", fill: "#8b5cf6" },
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1f2937",
                  border: "none",
                  borderRadius: "8px",
                  color: "#f9fafb",
                }}
              />
              <Legend />
              {gridStabilityDataAllJobs.length > 0 && (
                <Bar
                  dataKey="allJobs"
                  fill="#f59e0b"
                  name="All Jobs"
                  isAnimationActive={false}
                />
              )}
              {gridStabilityDataRlMin.length > 0 && (
                <Bar
                  dataKey="rlMin"
                  fill="#ef4444"
                  name="RL Min Instability"
                  isAnimationActive={false}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={styles.chartPlaceholder}>
            Waiting for data...
          </div>
        )}
      </div>

      {/* Log viewer */}
      <div style={styles.logContainer}>
        <h3 style={styles.logTitle}>Event Log</h3>
        <div style={styles.logContent} ref={logRef}>
          {log.length === 0 ? (
            <div style={styles.logEmpty}>No events yet...</div>
          ) : (
            log.map((line, idx) => (
              <div key={idx} style={styles.logLine}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

//
// 🎨 Modern UI Styles
//
const styles = {
  container: {
    padding: "30px",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
    maxWidth: "1400px",
    margin: "0 auto",
    backgroundColor: "#f9fafb",
    minHeight: "100vh",
  },

  header: {
    marginBottom: "30px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "20px",
  },

  headerRight: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    alignItems: "flex-end",
  },

  dataCounter: {
    padding: "8px 16px",
    backgroundColor: "#f3f4f6",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    fontSize: "14px",
    color: "#1f2937",
    fontWeight: "500",
  },

  title: {
    fontSize: "32px",
    fontWeight: "700",
    color: "#1f2937",
    margin: 0,
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },

  statusBox: (status) => ({
    padding: "12px 20px",
    backgroundColor:
      status === "Connected"
        ? "#d1fae5"
        : status === "Completed"
        ? "#dbeafe"
        : status === "Error"
        ? "#fee2e2"
        : "#fef3c7",
    border: "1px solid",
    borderColor:
      status === "Connected"
        ? "#10b981"
        : status === "Completed"
        ? "#3b82f6"
        : status === "Error"
        ? "#ef4444"
        : "#f59e0b",
    borderRadius: "12px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontWeight: "500",
    color: "#1f2937",
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
  }),

  statusDot: (status) => ({
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    backgroundColor:
      status === "Connected"
        ? "#10b981"
        : status === "Completed"
        ? "#3b82f6"
        : status === "Error"
        ? "#ef4444"
        : "#f59e0b",
    animation: status === "Connected" ? "pulse 2s infinite" : "none",
  }),

  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "20px",
    marginBottom: "30px",
  },

  metricCard: {
    backgroundColor: "#ffffff",
    padding: "24px",
    borderRadius: "12px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    border: "1px solid #e5e7eb",
    transition: "transform 0.2s, box-shadow 0.2s",
  },

  inlineMetricCard: {
    backgroundColor: "#ffffff",
    padding: "10px 12px",
    borderRadius: "12px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    border: "1px solid #e5e7eb",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    height: "85px",
    width: "100px",
    minWidth: "100px",
  },

  metricLabel: {
    fontSize: "14px",
    color: "#6b7280",
    fontWeight: "500",
    marginBottom: "8px",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },

  metricValue: {
    fontSize: "28px",
    fontWeight: "700",
    color: "#1f2937",
  },

  chartsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "20px",
    marginBottom: "30px",
  },

  chartContainer: {
    backgroundColor: "#ffffff",
    padding: "24px",
    borderRadius: "12px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    marginBottom: "30px",
    border: "1px solid #e5e7eb",
  },

  chartTitle: {
    fontSize: "20px",
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 0,
    marginTop: 0,
  },

  chartPlaceholder: {
    height: "400px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#9ca3af",
    fontSize: "16px",
  },

  logContainer: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    border: "1px solid #e5e7eb",
    overflow: "hidden",
  },

  logTitle: {
    fontSize: "18px",
    fontWeight: "600",
    color: "#1f2937",
    padding: "20px 24px",
    margin: 0,
    borderBottom: "1px solid #e5e7eb",
    backgroundColor: "#f9fafb",
  },

  logContent: {
    height: "300px",
    overflowY: "auto",
    padding: "16px 24px",
    fontSize: "13px",
    fontFamily: "'Monaco', 'Menlo', 'Courier New', monospace",
    backgroundColor: "#1f2937",
    color: "#e5e7eb",
  },

  logLine: {
    padding: "6px 0",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    color: "#9ca3af",
  },

  logEmpty: {
    color: "#6b7280",
    textAlign: "center",
    paddingTop: "100px",
    fontSize: "14px",
  },

  socIndicators: {
    display: "flex",
    gap: "20px",
    alignItems: "center",
  },

  socIndicator: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "5px",
    height: "85px",
  },

  batteryIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  flywheelIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  socText: {
    fontSize: "12px",
    fontWeight: "600",
    color: "#1f2937",
  },
};

export default App;
