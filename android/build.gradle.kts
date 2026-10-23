// Android Gradle Plugin 4.2.2 is the newest that runs on JDK 8 and build-tools 30.0.2,
// which is what Unity's bundled Android SDK ships with. Any newer SDK works too.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:4.2.2")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.5.31")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}
