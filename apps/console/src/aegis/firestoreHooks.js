/**
 * Live Firestore subscriptions, with automatic REST fallback.
 *
 * Each hook takes the SWR result it is replacing and returns the same shape, so
 * a screen can adopt live data by changing one line and needs no knowledge of
 * whether Firestore is available. When Firestore is configured and signed in,
 * the hook subscribes and the SWR poll is stood down; otherwise the SWR data
 * passes straight through.
 *
 * The point is that "live" is an upgrade, never a dependency.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { canSubscribe, firestore } from './firebase';

/** Firestore stores money as a string to stay exact; the UI wants a number. */
const normaliseDecision = (data) => ({
  ...data,
  amount: data.amount ?? '0',
  conformance: {
    score: data.conformance_score ?? null,
    rationale: data.conformance_rationale ?? '',
    model_version: data.model_version ?? '',
    available: data.conformance_available ?? true,
    vetoes: [],
    prompt_hash: '',
  },
  decided_at:
    data.decided_at?.toDate?.().toISOString?.() ?? data.decided_at ?? new Date().toISOString(),
});

/**
 * The live decision stream.
 *
 * `scope` mirrors what the security rules will enforce anyway. Applying it here
 * too is not redundant: without it Firestore would reject the whole query for a
 * non-operator, and the console would show nothing rather than their own rows.
 */
export const useLiveDecisions = (swrResult, { max = 60, scope, enabled = true } = {}) => {
  const [live, setLive] = useState(null);
  const [subscribed, setSubscribed] = useState(false);
  const scopeKey = JSON.stringify(scope ?? {});

  useEffect(() => {
    // `enabled` is false when the caller has narrowed to a fixed window. A
    // live feed would keep pushing the newest rows over a filtered result and
    // silently contradict the filter the user just chose.
    if (!enabled || !canSubscribe()) {
      setSubscribed(false);
      setLive(null);
      return undefined;
    }

    const constraints = [];
    if (scope?.operator_id) constraints.push(where('operator_id', '==', scope.operator_id));
    if (scope?.card_member_id)
      constraints.push(where('card_member_id', '==', scope.card_member_id));

    const q = query(
      collection(firestore, 'decisions'),
      ...constraints,
      orderBy('decided_at', 'desc'),
      fsLimit(max),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setLive(snapshot.docs.map((doc) => normaliseDecision(doc.data())));
        setSubscribed(true);
      },
      (error) => {
        // Most often a missing composite index or a rules denial. Either way
        // the console keeps working on REST.
        console.warn('Live decisions unavailable; using the REST API.', error);
        setSubscribed(false);
      },
    );

    return () => unsubscribe();
  }, [max, scopeKey, enabled]);

  return useMemo(() => {
    if (enabled && subscribed && live) {
      return { ...swrResult, data: { items: live, total: live.length }, isLive: true };
    }
    return { ...swrResult, isLive: false };
  }, [enabled, subscribed, live, swrResult]);
};

/** Live incidents feed. Same fallback contract. */
export const useLiveIncidents = (swrResult, { max = 20, scope } = {}) => {
  const [live, setLive] = useState(null);
  const [subscribed, setSubscribed] = useState(false);
  const scopeKey = JSON.stringify(scope ?? {});

  useEffect(() => {
    if (!canSubscribe()) return undefined;

    const constraints = [];
    if (scope?.operator_id) constraints.push(where('operator_id', '==', scope.operator_id));

    const q = query(
      collection(firestore, 'incidents'),
      ...constraints,
      orderBy('created_at', 'desc'),
      fsLimit(max),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setLive(
          snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              ...data,
              created_at:
                data.created_at?.toDate?.().toISOString?.() ??
                data.created_at ??
                new Date().toISOString(),
            };
          }),
        );
        setSubscribed(true);
      },
      (error) => {
        console.warn('Live incidents unavailable; using the REST API.', error);
        setSubscribed(false);
      },
    );

    return () => unsubscribe();
  }, [max, scopeKey]);

  return useMemo(
    () =>
      subscribed && live
        ? { ...swrResult, data: live, isLive: true }
        : { ...swrResult, isLive: false },
    [subscribed, live, swrResult],
  );
};

/**
 * Live fleet state.
 *
 * This one benefits most from being live: when an operator hits the emergency
 * stop, every other console should dim immediately rather than up to five
 * seconds later on the next poll.
 */
export const useLiveFleetState = (swrResult) => {
  const [live, setLive] = useState(null);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    if (!canSubscribe()) return undefined;

    const unsubscribe = onSnapshot(
      collection(firestore, 'fleet_state'),
      (snapshot) => {
        const doc = snapshot.docs.find((d) => d.id === 'current');
        if (doc) {
          const data = doc.data();
          setLive({
            ...data,
            stopped_at: data.stopped_at?.toDate?.().toISOString?.() ?? data.stopped_at ?? null,
            approvals_required: 2,
          });
          setSubscribed(true);
        }
      },
      (error) => {
        console.warn('Live fleet state unavailable; using the REST API.', error);
        setSubscribed(false);
      },
    );

    return () => unsubscribe();
  }, []);

  return useMemo(
    () =>
      subscribed && live
        ? { ...swrResult, data: live, isLive: true }
        : { ...swrResult, isLive: false },
    [subscribed, live, swrResult],
  );
};
