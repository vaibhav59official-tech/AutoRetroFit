package pages;

public class LoginPage {
  private boolean loggedIn;
  public void loginAsStudent() { loggedIn = true; }
  public boolean isLoggedIn() { return loggedIn; }
}
