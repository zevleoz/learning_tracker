import { motion } from 'framer-motion';

const SlideUp = ({ children, delay = 0, duration = 0.5, distance = 20, style = {}, className = '' }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: distance }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: distance }}
      transition={{ delay, duration, ease: [0.4, 0, 0.2, 1] }}
      style={style}
      className={className}
    >
      {children}
    </motion.div>
  );
};

export default SlideUp;