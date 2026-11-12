// GPL-2.0; native entry point around the unmodified upstream estimator.
#include "native.hpp"
int point_lio_main(int,char**);
extern std::deque<pcl::PointCloud<pcl::PointXYZINormal>::Ptr> lidar_buffer;
extern std::deque<double> time_buffer;
extern std::deque<sensor_msgs::Imu::ConstPtr> imu_deque;
extern double last_timestamp_imu;
int main(int argc,char**argv) {
  if(argc==2 && std::string(argv[1])=="--help") {
    std::cout<<"Usage: pointlio-mac CONFIG.yaml INPUT.ndjson OUTPUT.ndjson\n"
             <<"Use '-' for stdin/stdout. Replay raw LiDAR/IMU data locally; no ROS, network or robot motion.\n";
    return 0;
  }
  try {
    if(argc==4 && std::string(argv[3])=="-") {
      native::pose_fd=::dup(STDOUT_FILENO);
      if(native::pose_fd<0 || ::dup2(STDERR_FILENO,STDOUT_FILENO)<0) throw std::runtime_error("Cannot initialize pose output stream");
      std::cout.rdbuf(std::cerr.rdbuf());
    }
    native::can_drain=[] {
      if(lidar_buffer.empty() || time_buffer.empty() || imu_deque.empty()) return false;
      double end=time_buffer.front();
      for(const auto& point:*lidar_buffer.front()) end=std::max(end,time_buffer.front()+point.curvature/1000.0);
      return last_timestamp_imu>=end;
    };
    int result=point_lio_main(argc,argv);
    native::output_stream->flush();
    if(!*native::output_stream) throw std::runtime_error("Failed writing pose output");
    std::cerr<<"Input events: "<<native::events<<"; estimated poses: "<<native::poses<<"\n";
    if(!lidar_buffer.empty()) std::cerr<<"Unprocessed scans at input end: "<<lidar_buffer.size()<<" (missing matching IMU or session limit)\n";
    if(native::session_limit) { std::cerr<<"Session limit reached; start a new tracking session.\n";return 4; }
    if(!result && !native::poses) { std::cerr<<"No position estimates were produced.\n";return 3; }
    return result;
  } catch(const std::exception& error) { std::cerr<<error.what()<<"\n";return 2; }
}
