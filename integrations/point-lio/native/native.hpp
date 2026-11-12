// Native replay adapter for Point-LIO. Distributed under GPL-2.0 with upstream.
#pragma once
#include <algorithm>
#include <cassert>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <cerrno>
#include <deque>
#include <fstream>
#include <filesystem>
#include <functional>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <type_traits>
#include <vector>
#include <unistd.h>
#include <nlohmann/json.hpp>
#include <yaml-cpp/yaml.h>
#include <pcl/PCLPointCloud2.h>
#include <pcl/point_types.h>
#include <pcl/point_cloud.h>
#include <pcl/conversions.h>

#define ROS_WARN(...) do { std::fprintf(stderr, __VA_ARGS__); std::fprintf(stderr,"\n"); } while(0)
#define ROS_INFO(...) ROS_WARN(__VA_ARGS__)
#define ROS_ERROR(...) ROS_WARN(__VA_ARGS__)
#define ROS_ASSERT(value) assert(value)

namespace ros {
struct Time {
  double value=0;
  Time& fromSec(double v) { value=v;return *this; }
  double toSec() const { return value; }
};
}
namespace std_msgs { struct Header { ros::Time stamp; std::string frame_id; }; }
namespace geometry_msgs {
struct Vector3 { double x=0,y=0,z=0; };
struct Quaternion { double x=0,y=0,z=0,w=1; };
struct Pose { Vector3 position; Quaternion orientation; };
struct PoseStamped { std_msgs::Header header; Pose pose; };
}
namespace sensor_msgs {
struct Imu {
  using Ptr=std::shared_ptr<Imu>; using ConstPtr=std::shared_ptr<const Imu>;
  std_msgs::Header header;
  geometry_msgs::Vector3 angular_velocity, linear_acceleration;
  geometry_msgs::Quaternion orientation;
};
using ImuConstPtr=Imu::ConstPtr;
struct PointCloud2 {
  using ConstPtr=std::shared_ptr<const PointCloud2>;
  std_msgs::Header header; pcl::PCLPointCloud2 cloud;
};
}
namespace nav_msgs {
struct Odometry {
  std_msgs::Header header; std::string child_frame_id;
  struct { geometry_msgs::Pose pose; double covariance[36]={}; } pose;
};
struct Path { std_msgs::Header header; std::vector<geometry_msgs::PoseStamped> poses; };
}
namespace visualization_msgs { struct Marker {}; }
namespace tf {
struct Vector3 { Vector3(double,double,double){} };
struct Quaternion { void setW(double){} void setX(double){} void setY(double){} void setZ(double){} };
struct Transform { void setOrigin(Vector3){} void setRotation(Quaternion){} };
struct StampedTransform { StampedTransform(Transform,ros::Time,const char*,const char*){} };
struct TransformBroadcaster { void sendTransform(StampedTransform){} };
}
namespace pcl {
template<class T> void fromROSMsg(const sensor_msgs::PointCloud2& msg, pcl::PointCloud<T>& cloud) { fromPCLPointCloud2(msg.cloud, cloud); }
template<class T> void toROSMsg(const pcl::PointCloud<T>& cloud, sensor_msgs::PointCloud2& msg) { toPCLPointCloud2(cloud, msg.cloud); }
}

namespace native {
inline YAML::Node config;
inline std::ifstream input;
inline std::ofstream output;
inline std::istream* input_stream=&input;
inline std::ostream stdout_stream{std::cout.rdbuf()};
inline std::ostream* output_stream=&output;
inline int pose_fd=-1;
inline bool running=true;
inline bool eof=false;
inline std::function<bool()> can_drain=[] { return false; };
inline std::function<void(const sensor_msgs::Imu::ConstPtr&)> imu_callback;
inline std::function<void(const sensor_msgs::PointCloud2::ConstPtr&)> cloud_callback;
inline size_t events=0, poses=0;
inline double last_imu=-1,last_cloud=-1;
inline double first_stamp=-1,max_seconds=600;
inline size_t max_events=200000;
inline bool session_limit=false;
inline std::string session;

inline YAML::Node parameter(const std::string& key) {
  YAML::Node node=YAML::Clone(config); size_t start=0;
  while(start<key.size()) {
    auto end=key.find('/',start);
    node.reset(node[key.substr(start,end==std::string::npos?end:end-start)]);
    if(!node.IsDefined()) return YAML::Node();
    if(end==std::string::npos) break;
    start=end+1;
  }
  return node;
}
inline void receive() {
  std::string line;
  if(eof) return;
  if(!std::getline(*input_stream,line)) { eof=true; return; }
  if(line.empty()) return;
  if(line.size()>16*1024*1024) throw std::runtime_error("Input event exceeds 16 MB");
  const auto j=nlohmann::json::parse(line);
  const double stamp=j.at("stamp").get<double>();
  if(!std::isfinite(stamp)||stamp<=0) throw std::runtime_error("Invalid sensor timestamp");
  if(first_stamp<0) first_stamp=stamp;
  if(stamp-first_stamp>max_seconds || events>=max_events) { session_limit=true;running=false;return; }
  const std::string type=j.at("type");
  if(type=="imu") {
    if(stamp<=last_imu) throw std::runtime_error("IMU timestamps must increase"); last_imu=stamp;
    auto msg=std::make_shared<sensor_msgs::Imu>();msg->header.stamp.fromSec(stamp);
    auto values=j.at("gyro").get<std::vector<double>>();auto acc=j.at("accel").get<std::vector<double>>();
    if(values.size()!=3||acc.size()!=3) throw std::runtime_error("IMU needs gyro/accel triples");
    for(auto v:values) if(!std::isfinite(v)) throw std::runtime_error("Invalid gyro");
    for(auto v:acc) if(!std::isfinite(v)) throw std::runtime_error("Invalid acceleration");
    msg->angular_velocity={values[0],values[1],values[2]};msg->linear_acceleration={acc[0],acc[1],acc[2]};
    if(imu_callback) imu_callback(msg);
  } else if(type=="cloud") {
    if(stamp<=last_cloud) throw std::runtime_error("Cloud timestamps must increase"); last_cloud=stamp;
    auto msg=std::make_shared<sensor_msgs::PointCloud2>();msg->header.stamp.fromSec(stamp);
    auto points=j.at("points").get<std::vector<std::vector<float>>>();
    if(points.empty()||points.size()>90000) throw std::runtime_error("Cloud must contain 1..90000 raw points");
    auto& cloud=msg->cloud;cloud.height=1;cloud.width=points.size();cloud.point_step=24;cloud.row_step=cloud.width*24;cloud.is_dense=true;
    for(int i=0;i<5;i++) { pcl::PCLPointField f;f.name=std::vector<std::string>{"x","y","z","intensity","time"}[i];f.offset=i*4;f.count=1;f.datatype=pcl::PCLPointField::FLOAT32;cloud.fields.push_back(f); }
    pcl::PCLPointField ring;ring.name="ring";ring.offset=20;ring.count=1;ring.datatype=pcl::PCLPointField::UINT16;cloud.fields.push_back(ring);
    cloud.data.resize(cloud.row_step);
    for(size_t i=0;i<points.size();i++) {
      if(points[i].size()!=5) throw std::runtime_error("Each point needs x,y,z,intensity,time (seconds)");
      for(float v:points[i]) if(!std::isfinite(v)) throw std::runtime_error("Invalid point value");
      if(points[i][4]<0||points[i][4]>1) throw std::runtime_error("Per-point time must be a seconds offset within the scan");
      std::memcpy(cloud.data.data()+i*24,points[i].data(),20);
    }
    if(cloud_callback) cloud_callback(msg);
  } else throw std::runtime_error("Unsupported event type");
  ++events;
}
}

namespace ros {
struct Subscriber {};
struct Publisher {
  std::string topic;
  template<class T> void publish(const T& message) const {
    if constexpr(std::is_same_v<T,nav_msgs::Odometry>) {
      const auto& p=message.pose.pose.position; const auto& q=message.pose.pose.orientation;
      for(double v:{p.x,p.y,p.z,q.x,q.y,q.z,q.w}) if(!std::isfinite(v)) throw std::runtime_error("Estimator produced invalid pose");
      const auto line=nlohmann::json({{"session",native::session},{"stamp",message.header.stamp.toSec()},
        {"frame",message.header.frame_id},{"position",{p.x,p.y,p.z}},{"quaternion_xyzw",{q.x,q.y,q.z,q.w}}}).dump()+"\n";
      if(native::pose_fd>=0) {
        size_t offset=0;
        while(offset<line.size()) {
          auto count=::write(native::pose_fd,line.data()+offset,line.size()-offset);
          if(count<0 && errno==EINTR) continue;
          if(count<=0) throw std::runtime_error("Failed writing pose stream");
          offset+=static_cast<size_t>(count);
        }
      } else {
        *native::output_stream<<line;
        native::output_stream->flush();
        if(!*native::output_stream) throw std::runtime_error("Failed writing pose output");
      }
      ++native::poses;
    }
  }
};
inline void init(int argc,char**argv,const char*) {
  if(argc!=4) throw std::runtime_error("Usage: pointlio-mac CONFIG.yaml INPUT.ndjson OUTPUT.ndjson");
  if(std::string(argv[2])!="-" && std::string(argv[3])!="-" && std::filesystem::exists(argv[3]) && std::filesystem::equivalent(argv[2],argv[3])) throw std::runtime_error("Input and output paths must differ");
  native::config=YAML::LoadFile(argv[1]);
  for(const auto& setting:std::vector<std::pair<std::string,size_t>>{{"mapping/extrinsic_T",3},{"mapping/extrinsic_R",9},{"mapping/gravity",3},{"mapping/gravity_init",3}}) {
    auto node=native::parameter(setting.first);
    if(!node.IsSequence() || node.size()!=setting.second) throw std::runtime_error("Invalid required configuration: "+setting.first);
    for(auto value:node) if(!std::isfinite(value.as<double>())) throw std::runtime_error("Nonfinite configuration value");
  }
  if(std::string(argv[2])=="-") native::input_stream=&std::cin; else { native::input.open(argv[2]);if(!native::input) throw std::runtime_error("Cannot open input file"); }
  if(std::string(argv[3])=="-") native::output_stream=&native::stdout_stream; else { native::output.open(argv[3]);if(!native::output) throw std::runtime_error("Cannot open output file"); }
  auto duration=native::parameter("native/max_seconds");
  if(duration.IsDefined()&&!duration.IsNull()) native::max_seconds=duration.as<double>();
  if(!std::isfinite(native::max_seconds)||native::max_seconds<=0||native::max_seconds>3600) throw std::runtime_error("native/max_seconds must be in (0,3600]");
  native::session=std::to_string(std::chrono::steady_clock::now().time_since_epoch().count());
}
struct NodeHandle {
  explicit NodeHandle(const char*){}
  template<class T> void param(const std::string& key,T& value,const T& fallback) {
    auto node=native::parameter(key);
    if constexpr(std::is_same_v<T,bool>) {
      if(node.IsScalar() && node.Scalar()=="enable") { value=true; return; }
    }
    value=node.IsDefined()&&!node.IsNull()?node.as<T>():fallback;
  }
  template<class T> Subscriber subscribe(const std::string&,int,void(*callback)(const std::shared_ptr<const T>&)) {
    if constexpr(std::is_same_v<T,sensor_msgs::Imu>) native::imu_callback=callback;
    else if constexpr(std::is_same_v<T,sensor_msgs::PointCloud2>) native::cloud_callback=callback;
    return {};
  }
  template<class T> Publisher advertise(const std::string& topic,int) { return {topic}; }
};
struct Rate { explicit Rate(int){} void sleep(){} };
inline bool ok() { return native::running && (!native::eof || native::can_drain()); }
inline void spinOnce() { native::receive(); }
}
