export type DroneModel = "DJI Matrice 30T" | "DJI Matrice 4T";

export type DroneOnlineStatus = "online" | "offline" | "unknown";

export type FleetStatus = {
  max_simultaneous_drones: number;
  online_drones: string[];
  offline_drones: string[];
  supported_models: DroneModel[];
};

