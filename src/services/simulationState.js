const startTime = Date.now();

export const SIM_STATE = {
    simTime: startTime,
    realTime: startTime,
    speed: 1,
    paused: false,
    revision: 0
};

export function updateSimulationTime(now = Date.now()) {
    if (!SIM_STATE.paused) {
        SIM_STATE.simTime += (now - SIM_STATE.realTime) * SIM_STATE.speed;
    }
    SIM_STATE.realTime = now;
}

export function setSimulationSpeed(speed) {
    updateSimulationTime();
    SIM_STATE.speed = speed;
}

export function setSimulationPaused(paused) {
    updateSimulationTime();
    SIM_STATE.paused = paused;
}

export function resetSimulationTime() {
    SIM_STATE.simTime = SIM_STATE.realTime = Date.now();
    SIM_STATE.revision++;
}
