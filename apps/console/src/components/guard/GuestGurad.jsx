import { Navigate } from 'react-router';
import { useAuth } from 'providers/AuthProvider';

const GuestGurad = ({ children }) => {
  const { sessionUser } = useAuth();

  return sessionUser ? <Navigate to="/" /> : children;
};

export default GuestGurad;
