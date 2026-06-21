import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Syllabus from './pages/Syllabus.jsx';
import Learning from './pages/Learning.jsx';
import Review from './pages/Review.jsx';
import Mentor from './pages/Mentor.jsx';
import Notifications from './pages/Notifications.jsx';
import DebugTools from './pages/DebugTools.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/syllabus" replace />} />
          <Route path="/syllabus" element={<Syllabus />} />
          <Route path="/learning" element={<Learning />} />
          <Route path="/review" element={<Review />} />
          <Route path="/mentor" element={<Mentor />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/debug-tools" element={<DebugTools />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
