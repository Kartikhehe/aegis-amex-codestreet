import { Navigate } from 'react-router';
import { useAuth } from 'providers/AuthProvider';
import paths from 'routes/paths';

const AuthGurad = ({ children }) => {
  const { sessionUser } = useAuth();

  return sessionUser ? children : <Navigate to={paths.defaultJwtLogin} />;
};

export default AuthGurad;
