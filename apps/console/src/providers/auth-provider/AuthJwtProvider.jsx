import { createContext, use, useCallback, useEffect, useState } from 'react';
import { signInToFirebase, signOutOfFirebase } from 'aegis/firebase';
import { removeItemFromStore } from 'lib/utils';
import { useGetCurrentUser } from 'services/swr/api-hooks/useAuthApi';

export const AuthJwtContext = createContext({});

const AuthJwtProvider = ({ children }) => {
  const [sessionUser, setSessionUser] = useState(null);

  const { data } = useGetCurrentUser();

  const setSession = useCallback(
    (user, token, firebaseToken) => {
      setSessionUser(user);
      // Exchange the AEGIS session for a Firebase one so Firestore's security
      // rules can scope live reads by the same role. Failure is silent: the
      // console falls back to REST and stays fully usable.
      if (firebaseToken) {
        signInToFirebase(firebaseToken);
      }
      if (token) {
        localStorage.setItem('auth_token', token);
      }
    },
    [setSessionUser],
  );

  const signout = useCallback(() => {
    signOutOfFirebase();
    setSessionUser(null);
    removeItemFromStore('session_user');
    removeItemFromStore('auth_token');
  }, [setSessionUser, sessionUser]);

  useEffect(() => {
    if (data) {
      setSession(data);
    }
  }, [data]);

  return (
    <AuthJwtContext value={{ sessionUser, setSessionUser, setSession, signout }}>
      {children}
    </AuthJwtContext>
  );
};

export const useAuth = () => use(AuthJwtContext);

export const demoUser = {
  id: 0,
  email: 'guest@aegis.test',
  name: 'Guest',
  designation: 'Operator',
};

export default AuthJwtProvider;
