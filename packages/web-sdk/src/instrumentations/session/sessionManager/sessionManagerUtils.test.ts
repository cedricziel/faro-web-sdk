import { initializeFaro } from '@grafana/faro-core';
import * as faroCore from '@grafana/faro-core';
import { mockConfig } from '@grafana/faro-core/src/testUtils';

import { SESSION_EXPIRATION_TIME, SESSION_INACTIVITY_TIME } from './sessionConstants';
import * as mockSessionManagerUtils from './sessionManagerUtils';
import {
  addSessionMetadataToNextSession,
  createUserSessionObject,
  getUserSessionUpdater,
  isUserSessionValid,
} from './sessionManagerUtils';
import type { FaroUserSession } from './types';

const fakeSystemTime = new Date('2023-01-01').getTime();
const mockSessionId = '123';

describe('sessionManagerUtils', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(fakeSystemTime);
  });

  beforeEach(() => {
    jest.resetAllMocks();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('creates new user session object.', () => {
    jest.spyOn(faroCore, 'genShortID').mockReturnValue(mockSessionId);

    // create new id
    const newSession = createUserSessionObject();

    expect(newSession).toStrictEqual({
      sessionId: mockSessionId,
      lastActivity: fakeSystemTime,
      started: fakeSystemTime,
    });

    // create with given sessionId
    const mockInitialSessionId = 'abcde';
    const newSessionWithInitialSessionId = createUserSessionObject(mockInitialSessionId);

    expect(newSessionWithInitialSessionId).toStrictEqual({
      sessionId: mockInitialSessionId,
      lastActivity: fakeSystemTime,
      started: fakeSystemTime,
    });
  });

  it('checks if user session is valid.', () => {
    jest.spyOn(faroCore, 'genShortID').mockReturnValue(mockSessionId);

    // return false if session is null
    const isNullSessionInvalid = isUserSessionValid(null);
    expect(isNullSessionInvalid).toBe(false);

    // return false if activity timeout is reached
    const newInactiveSession = createUserSessionObject();
    newInactiveSession.lastActivity = SESSION_INACTIVITY_TIME;
    const isActivityTimeoutSessionInvalid = isUserSessionValid(newInactiveSession);
    expect(isActivityTimeoutSessionInvalid).toBe(false);

    // return false if lifetime timeout is reached
    const newTimedOutSession = createUserSessionObject();
    newTimedOutSession.started -= SESSION_EXPIRATION_TIME;
    const isTimedOutSessionInvalid = isUserSessionValid(newTimedOutSession);
    expect(isTimedOutSessionInvalid).toBe(false);

    // return false if session is null
    const isNullSessionValid = isUserSessionValid(createUserSessionObject());
    expect(isNullSessionValid).toBe(true);

    // return false if activity timeout is reached
    const newActiveSession = createUserSessionObject();
    newActiveSession.lastActivity = fakeSystemTime - 1;
    const isActivityTimeoutSessionValid = isUserSessionValid(newActiveSession);
    expect(isActivityTimeoutSessionValid).toBe(true);

    // return false if lifetime timeout is reached
    const newSessionWithValidLifetime = createUserSessionObject();
    newSessionWithValidLifetime.started -= SESSION_EXPIRATION_TIME - 1;
    const isTimedOutSessionValid = isUserSessionValid(newSessionWithValidLifetime);
    expect(isTimedOutSessionValid).toBe(true);
  });

  it('configures userSessionUpdater and expands the current user session as well as the current sessionMeta.', () => {
    const mockOnSessionChange = jest.fn();

    const config = mockConfig({
      sessionTracking: {
        onSessionChange: mockOnSessionChange,
      },
    });

    const faro = initializeFaro(config);

    const mockFetchUserSession = jest.fn();
    const mockStoreUserSession = jest.fn();

    const updateSession = getUserSessionUpdater({
      fetchUserSession: mockFetchUserSession,
      storeUserSession: mockStoreUserSession,
    });

    // session is invalid
    jest.spyOn(mockSessionManagerUtils, 'isUserSessionValid').mockReturnValueOnce(false);

    const mockSetSession = jest.fn();
    jest.spyOn(faro.api, 'setSession').mockImplementationOnce(mockSetSession);

    mockFetchUserSession.mockReturnValueOnce({
      sessionId: 'abc',
      attributes: {
        previousSession: 'previousSession',
      },
    });

    jest.spyOn(faroCore, 'genShortID').mockReturnValueOnce(mockSessionId);

    updateSession();

    expect(mockFetchUserSession).toHaveBeenCalledTimes(1);
    expect(mockStoreUserSession).toHaveBeenCalledTimes(1);
    expect(mockSetSession).toHaveBeenCalledTimes(1);
    expect(mockOnSessionChange).toHaveBeenCalledTimes(1);

    expect(mockSetSession).toHaveBeenCalledWith({
      id: mockSessionId,
      attributes: {
        previousSession: 'abc',
      },
    });

    expect(mockOnSessionChange).toHaveBeenCalledWith(null, { attributes: { previousSession: 'abc' }, id: '123' });
  });

  it('configures userSessionUpdater and expands the current user session as well as the current sessionMeta for a session which already got expanded.', () => {
    const currentSessionMeta = {
      id: 'currentSession',
      attributes: { previousSession: 'previous' },
    };

    const mockOnSessionChange = jest.fn();

    const config = mockConfig({
      sessionTracking: {
        onSessionChange: mockOnSessionChange,
      },
      session: currentSessionMeta,
    });

    const faro = initializeFaro(config);

    const mockFetchUserSession = jest.fn();
    const mockStoreUserSession = jest.fn();

    const updateSession = getUserSessionUpdater({
      fetchUserSession: mockFetchUserSession,
      storeUserSession: mockStoreUserSession,
    });

    // session is invalid
    jest.spyOn(mockSessionManagerUtils, 'isUserSessionValid').mockReturnValueOnce(false);

    const mockSetSession = jest.fn();
    jest.spyOn(faro.api, 'setSession').mockImplementationOnce(mockSetSession);

    mockFetchUserSession.mockReturnValue({
      sessionId: currentSessionMeta.id,
      attributes: {
        previousSession: currentSessionMeta.attributes.previousSession,
      },
      sessionMeta: currentSessionMeta,
    });

    const nextSessionId = 'nextSession';
    jest.spyOn(faroCore, 'genShortID').mockReturnValueOnce(nextSessionId);

    updateSession();

    const newSessionMeta = {
      id: nextSessionId,
      attributes: {
        previousSession: currentSessionMeta.id,
      },
    };

    expect(mockSetSession).toHaveBeenCalledWith(newSessionMeta);

    expect(mockOnSessionChange).toHaveBeenCalledWith(currentSessionMeta, newSessionMeta);
  });

  it('Takes session object and adds meta data.', () => {
    const config = mockConfig({});
    initializeFaro(config);

    const newSession: FaroUserSession = {
      lastActivity: 1,
      started: 2,
      sessionId: 'new-session-id',
    };

    const sessionWithMetadata1 = addSessionMetadataToNextSession(newSession, null);

    expect(sessionWithMetadata1).toStrictEqual({
      ...newSession,
      sessionMeta: {
        id: newSession.sessionId,
      },
    });

    const previousSession: FaroUserSession = {
      lastActivity: 8,
      started: 9,
      sessionId: 'previous-session-id',
    };

    const sessionWithMetadata2 = addSessionMetadataToNextSession(newSession, previousSession);

    expect(sessionWithMetadata2).toStrictEqual({
      ...newSession,
      sessionMeta: {
        id: newSession.sessionId,
        attributes: {
          previousSession: previousSession.sessionId,
        },
      },
    });

    const sessionMeta = {
      id: previousSession.sessionId,
      attributes: {
        previousSession: '12345',
        foo: 'bar',
        baz: 'bam',
      },
    };

    const config2 = mockConfig({
      session: sessionMeta,
    });
    initializeFaro(config2);

    const sessionWithMetadata3 = addSessionMetadataToNextSession(newSession, previousSession);

    expect(sessionWithMetadata3).toStrictEqual({
      ...newSession,
      sessionMeta: {
        id: newSession.sessionId,
        attributes: {
          ...sessionMeta.attributes,
          previousSession: previousSession.sessionId,
        },
      },
    });
  });
});
