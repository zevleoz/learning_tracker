import { motion } from 'framer-motion';

const FadeIn = ({ children, delay = 0, duration = 0.4, style = {}, className = '', initial = { opacity: 0 }, animate = { opacity: 1 }, exit = { opacity: 0 } }) => {
  return (
    <motion.div
      initial={initial}
      animate={animate}
      exit={exit}
      transition={{ delay, duration, ease: [0.4, 0, 0.2, 1] }}
      style={style}
      className={className}
    >
      {children}
    </motion.div>
  );
};

export default FadeIn;