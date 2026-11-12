// Read-only DDS endpoint discovery. No application data writers or robot commands.
#include <dds/dds.h>
#include <chrono>
#include <iostream>
#include <regex>
#include <set>
#include <string>
#include <thread>

int main(int argc, char** argv) {
  if (argc != 3 || !std::regex_match(argv[1], std::regex("[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+")))
    { std::cerr << "Usage: dds-discover ROBOT_IPV4 WIFI_INTERFACE\n"; return 2; }
  const std::string iface=argv[2];
  if (!std::regex_match(iface,std::regex("[a-zA-Z0-9]+"))) return 2;
  const std::string xml="<CycloneDDS><Domain Id=\"0\"><General><Interfaces><NetworkInterface name=\""+iface+
    "\"/></Interfaces><AllowMulticast>true</AllowMulticast></General><Discovery><Peers><Peer Address=\""+argv[1]+
    "\"/></Peers><ParticipantIndex>auto</ParticipantIndex><MaxAutoParticipantIndex>30</MaxAutoParticipantIndex></Discovery></Domain></CycloneDDS>";
  const auto domain=dds_create_domain(0,xml.c_str());
  if(domain<0) { std::cerr<<"DDS domain: "<<dds_strretcode(domain)<<"\n";return 2; }
  const auto participant=dds_create_participant(0,nullptr,nullptr);
  const auto reader=dds_create_reader(participant,DDS_BUILTIN_TOPIC_DCPSPUBLICATION,nullptr,nullptr);
  if(reader<0) { std::cerr<<"DDS reader: "<<dds_strretcode(reader)<<"\n";dds_delete(domain);return 2; }
  std::set<std::string> names;
  const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(15);
  while(std::chrono::steady_clock::now()<end) {
    void* samples[64]={}; dds_sample_info_t info[64];
    auto count=dds_take(reader,samples,info,64,64);
    if(count<0) { std::cerr<<"DDS read failed\n";break; }
    for(int i=0;i<count;i++) if(info[i].valid_data) {
      auto* sample=static_cast<dds_builtintopic_endpoint_t*>(samples[i]);
      const std::string name=sample->topic_name;
      if(names.insert(name).second && (name.find("utlidar")!=std::string::npos || name.find("lowstate")!=std::string::npos))
        std::cout<<name<<" | "<<sample->type_name<<"\n";
    }
    if(count>0) dds_return_loan(reader,samples,count);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
  std::cout<<"Discovered publication topic names: "<<names.size()<<"\n";
  dds_delete(participant);dds_delete(domain);
  return 0;
}
