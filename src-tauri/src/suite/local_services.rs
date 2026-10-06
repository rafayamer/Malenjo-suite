use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ServiceDescriptor {
    pub id: &'static str,
    pub display_name: &'static str,
    pub localhost_only: bool,
    pub autostart: bool,
}

pub struct LocalServiceManager;

impl LocalServiceManager {
    pub fn catalog() -> Vec<ServiceDescriptor> {
        vec![
            ServiceDescriptor { id:"java-api", display_name:"MALENJO Java API", localhost_only:true, autostart:false },
            ServiceDescriptor { id:"stirling-core", display_name:"MALENJO PDF Core (Stirling open core)", localhost_only:true, autostart:false },
            ServiceDescriptor { id:"ocr", display_name:"PaddleOCR Worker", localhost_only:true, autostart:false },
            ServiceDescriptor { id:"ai", display_name:"Local AI Runtime", localhost_only:true, autostart:false },
            ServiceDescriptor { id:"workflow", display_name:"Workflow Service", localhost_only:true, autostart:false },
        ]
    }
}
