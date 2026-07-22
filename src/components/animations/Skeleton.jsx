import { motion } from 'framer-motion';

const Skeleton = ({ className = '', style = {}, height = 16, width = '100%' }) => {
  return (
    <motion.div
      className={className}
      style={{
        ...style,
        height,
        width,
        backgroundColor: 'rgba(148, 163, 184, 0.2)',
        borderRadius: 8,
      }}
      animate={{
        opacity: [0.6, 0.8, 0.6],
      }}
      transition={{
        duration: 1.5,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    />
  );
};

export default Skeleton;