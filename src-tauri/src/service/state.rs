use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum ServiceStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
    Unhealthy,
    External,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ServiceEvent {
    StartRequested,
    Ready,
    PortOccupiedExternalConfirmed,
    Timeout,
    ProcessExited,
    StopRequested,
    StopCompleted,
    HealthFailedThreeTimes,
    HealthRestored,
    RestartRequested,
    DisconnectExternal,
    CleanupError,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StateTransitionError {
    pub status: ServiceStatus,
    pub event: ServiceEvent,
}

pub fn transition(
    status: ServiceStatus,
    event: ServiceEvent,
) -> Result<ServiceStatus, StateTransitionError> {
    use ServiceEvent::*;
    use ServiceStatus::*;

    let next = match (&status, &event) {
        (Stopped, StartRequested) => Starting,
        (Starting, Ready) => Running,
        (Starting, PortOccupiedExternalConfirmed) => External,
        (Starting, Timeout) => Error,
        (Starting, ProcessExited) => Error,
        (Running, HealthFailedThreeTimes) => Unhealthy,
        (Running, ProcessExited) => Error,
        (Running, StopRequested) => Stopping,
        (Unhealthy, HealthRestored) => Running,
        (Unhealthy, RestartRequested) => Stopping,
        (Unhealthy, ProcessExited) => Error,
        (Stopping, StopCompleted) => Stopped,
        (Stopping, Timeout) => Error,
        (External, DisconnectExternal) => Stopped,
        (External, ProcessExited) => Stopped,
        (Error, RestartRequested) => Starting,
        (Error, CleanupError) => Stopped,
        _ => return Err(StateTransitionError { status, event }),
    };

    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_documented_state_transitions() {
        use ServiceEvent::*;
        use ServiceStatus::*;

        let cases = [
            (Stopped, StartRequested, Starting),
            (Starting, Ready, Running),
            (Starting, PortOccupiedExternalConfirmed, External),
            (Starting, Timeout, Error),
            (Starting, ProcessExited, Error),
            (Running, HealthFailedThreeTimes, Unhealthy),
            (Running, ProcessExited, Error),
            (Running, StopRequested, Stopping),
            (Unhealthy, HealthRestored, Running),
            (Unhealthy, RestartRequested, Stopping),
            (Unhealthy, ProcessExited, Error),
            (Stopping, StopCompleted, Stopped),
            (Stopping, Timeout, Error),
            (External, DisconnectExternal, Stopped),
            (External, ProcessExited, Stopped),
            (Error, RestartRequested, Starting),
            (Error, CleanupError, Stopped),
        ];

        for (status, event, expected) in cases {
            assert_eq!(transition(status, event), Ok(expected));
        }
    }

    #[test]
    fn rejects_undocumented_state_transitions() {
        use ServiceEvent::*;
        use ServiceStatus::*;

        let cases = [
            (Starting, StopRequested),
            (External, StopRequested),
            (Stopped, StopRequested),
            (Running, StartRequested),
        ];

        for (status, event) in cases {
            assert!(matches!(
                transition(status.clone(), event.clone()),
                Err(StateTransitionError { .. })
            ));
        }
    }
}
