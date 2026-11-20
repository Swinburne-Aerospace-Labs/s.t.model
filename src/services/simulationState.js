export const SIM_STATE = {
    simTime: Date.now(),
    realTime: Date.now(),
    speed: 1,
    paused: false,
    revision: 0
};

export function setSimulationSpeed(speed) {
    SIM_STATE.speed = speed;
}

export function setSimulationPaused(paused) {
    SIM_STATE.paused = paused;
}

export function resetSimulationTime() {
    SIM_STATE.simTime = Date.now();
    SIM_STATE.revision++;
}
