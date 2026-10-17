package helpers;

public class AuthHelper {
  private final pages.LoginPage loginPage = new pages.LoginPage();
  public void loginAsStudent() { loginPage.loginAsStudent(); }
  public boolean isAuthenticated() { return loginPage.isLoggedIn(); }
}
