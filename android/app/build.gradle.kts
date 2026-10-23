plugins {
    id("com.android.application")
    id("kotlin-android")
}

val firejamUrl = (project.findProperty("firejamUrl") as String?) ?: "https://d12le9d1o14nhz.cloudfront.net"

android {
    compileSdkVersion(30)
    buildToolsVersion("30.0.2")

    defaultConfig {
        applicationId = "app.firejam.tv"
        // Fire OS 5 (Fire TV Stick 1st gen) is API 22; every Fire OS device since runs this.
        minSdkVersion(22)
        // Fire OS 8 is API 30.
        targetSdkVersion(30)
        versionCode = 2
        versionName = "0.2.0"
        buildConfigField("String", "FIREJAM_URL", "\"$firejamUrl\"")
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            // Debug-signed so the hackathon build can be sideloaded straight away.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.5.31")
}
