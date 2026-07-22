import { motion } from 'framer-motion';

const ScaleIn = ({ children, delay = 0, duration = 0.4, style = {}, className = '' }) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay, duration, ease: [0.4, 0, 0.2, 1] }}
      style={style}
      className={className}
    >
      {children}
    </motion.div>
  );
};

export default ScaleIn;