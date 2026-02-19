import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'socialsez_api.dart';

void main() {
  runApp(const SocialSezApp());
}

class SocialSezApp extends StatefulWidget {
  const SocialSezApp({super.key});

  @override
  State<SocialSezApp> createState() => _SocialSezAppState();
}

class _SocialSezAppState extends State<SocialSezApp> {
  final SessionController _session = SessionController();

  @override
  void dispose() {
    _session.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _session,
      builder: (context, _) {
        return MaterialApp(
          title: 'SocialSez Mobile',
          theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo)),
          home: _session.isAuthenticated ? MainShell(session: _session) : AuthScreen(session: _session),
        );
      },
    );
  }
}

class SessionController extends ChangeNotifier {
  SocialSezApi _api = const SocialSezApi();
  ProfileDto? profile;
  List<PostDto> feed = const [];
  String status = '';
  DateTime? nextRefreshAtUtc;
  Timer? _silentRefreshTimer;

  bool get isAuthenticated => _api.token != null && _api.token!.isNotEmpty;

  @override
  void dispose() {
    _silentRefreshTimer?.cancel();
    super.dispose();
  }

  Future<void> register({
    required String email,
    required String password,
    required String handle,
    required String displayName,
    required String bio,
  }) async {
    status = 'Registering...';
    notifyListeners();

    final auth = await _api.register(
      email: email,
      password: password,
      handle: handle,
      displayName: displayName,
      bio: bio,
    );

    _api = _api.withSession(auth.token, auth.refreshToken);
    profile = auth.profile;
    status = 'Registered as ${auth.profile.handle}';
    _scheduleSilentRefresh(auth.expiresAtUtc);

    await refreshFeed();
  }

  Future<void> login({required String email, required String password}) async {
    status = 'Logging in...';
    notifyListeners();

    final auth = await _api.login(email: email, password: password);
    _api = _api.withSession(auth.token, auth.refreshToken);
    profile = auth.profile;
    status = 'Logged in';
    _scheduleSilentRefresh(auth.expiresAtUtc);

    await refreshFeed();
  }

  Future<void> manualRefreshSession() async {
    status = 'Refreshing session...';
    notifyListeners();

    final auth = await _api.refresh();
    _api = _api.withSession(auth.token, auth.refreshToken);
    profile = auth.profile;
    status = 'Session refreshed';
    _scheduleSilentRefresh(auth.expiresAtUtc);
    notifyListeners();
  }

  Future<void> logout() async {
    await _api.revoke();
    _clearSession();
    status = 'Logged out';
    notifyListeners();
  }

  Future<void> refreshFeed() async {
    if (!isAuthenticated) {
      return;
    }

    feed = await _api.getFeed();
    notifyListeners();
  }

  Future<void> createPost(String content) async {
    await _api.createPost(content: content);
    status = 'Post created';
    await refreshFeed();
  }

  Future<ProfileDto> loadPublicProfile(String handle) {
    return _api.getProfile(handle);
  }

  Future<void> follow(String followedId) async {
    await _api.follow(followedId);
    status = 'Now following user';
    notifyListeners();
  }

  Future<void> refreshMe() async {
    profile = await _api.getMe();
    notifyListeners();
  }

  Future<void> updateMyProfile(String displayName, String bio) async {
    profile = await _api.updateMe(UpdateProfileRequest(displayName: displayName, bio: bio));
    status = 'Profile updated';
    notifyListeners();
  }

  void _scheduleSilentRefresh(DateTime expiresAtUtc) {
    _silentRefreshTimer?.cancel();

    final now = DateTime.now().toUtc();
    final refreshAt = expiresAtUtc.toUtc().subtract(const Duration(seconds: 60));
    final delay = refreshAt.isAfter(now) ? refreshAt.difference(now) : const Duration(seconds: 15);

    _silentRefreshTimer = Timer(delay, () {
      _refreshSessionSilently();
    });

    nextRefreshAtUtc = DateTime.now().toUtc().add(delay);
    notifyListeners();
  }

  Future<void> _refreshSessionSilently() async {
    try {
      final auth = await _api.refresh();
      _api = _api.withSession(auth.token, auth.refreshToken);
      profile = auth.profile;
      _scheduleSilentRefresh(auth.expiresAtUtc);
    } catch (_) {
      _clearSession();
      status = 'Session expired. Please login again.';
      notifyListeners();
    }
  }

  void _clearSession() {
    _silentRefreshTimer?.cancel();
    nextRefreshAtUtc = null;
    profile = null;
    feed = const [];
    _api = const SocialSezApi();
  }
}

class AuthScreen extends StatefulWidget {
  final SessionController session;

  const AuthScreen({super.key, required this.session});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final emailController = TextEditingController();
  final passwordController = TextEditingController();
  final handleController = TextEditingController();
  final displayNameController = TextEditingController();
  final bioController = TextEditingController();
  String error = '';

  @override
  void dispose() {
    emailController.dispose();
    passwordController.dispose();
    handleController.dispose();
    displayNameController.dispose();
    bioController.dispose();
    super.dispose();
  }

  Future<void> register() async {
    setState(() => error = '');
    try {
      await widget.session.register(
        email: emailController.text.trim(),
        password: passwordController.text,
        handle: handleController.text.trim(),
        displayName: displayNameController.text.trim(),
        bio: bioController.text.trim(),
      );
    } catch (_) {
      setState(() => error = 'Registration failed.');
    }
  }

  Future<void> login() async {
    setState(() => error = '');
    try {
      await widget.session.login(
        email: emailController.text.trim(),
        password: passwordController.text,
      );
    } catch (_) {
      setState(() => error = 'Invalid credentials.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('SocialSez · Sign in')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (widget.session.status.isNotEmpty) Text(widget.session.status),
          TextField(controller: emailController, decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: passwordController, obscureText: true, decoration: const InputDecoration(labelText: 'Password', border: OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: handleController, decoration: const InputDecoration(labelText: 'Handle (register)', border: OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: displayNameController, decoration: const InputDecoration(labelText: 'Display Name (register)', border: OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: bioController, decoration: const InputDecoration(labelText: 'Bio (register)', border: OutlineInputBorder())),
          const SizedBox(height: 10),
          Wrap(spacing: 10, children: [
            ElevatedButton(onPressed: register, child: const Text('Register')),
            ElevatedButton(onPressed: login, child: const Text('Login')),
          ]),
          if (error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(error, style: const TextStyle(color: Colors.red)),
            )
        ],
      ),
    );
  }
}

class MainShell extends StatefulWidget {
  final SessionController session;

  const MainShell({super.key, required this.session});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = [
      FeedScreen(session: widget.session),
      ComposeScreen(session: widget.session),
      DiscoverScreen(session: widget.session),
      ProfileScreen(session: widget.session),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('SocialSez Mobile'),
        actions: [
          IconButton(onPressed: widget.session.manualRefreshSession, icon: const Icon(Icons.refresh)),
          IconButton(onPressed: widget.session.logout, icon: const Icon(Icons.logout)),
        ],
      ),
      body: Column(
        children: [
          if (widget.session.status.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: Text(widget.session.status),
            ),
          if (kDebugMode && widget.session.nextRefreshAtUtc != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
              child: Text('[debug] Next refresh: ${widget.session.nextRefreshAtUtc!.toLocal()}', style: const TextStyle(fontSize: 12, color: Colors.black54)),
            ),
          Expanded(child: pages[index]),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Feed'),
          NavigationDestination(icon: Icon(Icons.edit_outlined), label: 'Compose'),
          NavigationDestination(icon: Icon(Icons.search), label: 'Discover'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
        ],
      ),
    );
  }
}

class FeedScreen extends StatelessWidget {
  final SessionController session;

  const FeedScreen({super.key, required this.session});

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: session.refreshFeed,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          ElevatedButton(onPressed: session.refreshFeed, child: const Text('Refresh Feed')),
          const SizedBox(height: 8),
          ...session.feed.map((post) => Card(
                child: ListTile(
                  title: Text(post.authorHandle),
                  subtitle: Text(post.content),
                  trailing: Text(post.createdAtUtc.substring(0, 16)),
                ),
              )),
          if (session.feed.isEmpty) const Padding(padding: EdgeInsets.all(12), child: Text('No posts yet.')),
        ],
      ),
    );
  }
}

class ComposeScreen extends StatefulWidget {
  final SessionController session;

  const ComposeScreen({super.key, required this.session});

  @override
  State<ComposeScreen> createState() => _ComposeScreenState();
}

class _ComposeScreenState extends State<ComposeScreen> {
  final controller = TextEditingController();

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (controller.text.trim().isEmpty) {
      return;
    }

    await widget.session.createPost(controller.text.trim());
    controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        TextField(
          controller: controller,
          minLines: 4,
          maxLines: 8,
          decoration: const InputDecoration(labelText: 'Write a post', border: OutlineInputBorder()),
        ),
        const SizedBox(height: 10),
        ElevatedButton(onPressed: submit, child: const Text('Publish')),
      ],
    );
  }
}

class DiscoverScreen extends StatefulWidget {
  final SessionController session;

  const DiscoverScreen({super.key, required this.session});

  @override
  State<DiscoverScreen> createState() => _DiscoverScreenState();
}

class _DiscoverScreenState extends State<DiscoverScreen> {
  final handleController = TextEditingController();
  ProfileDto? result;
  String status = '';

  @override
  void dispose() {
    handleController.dispose();
    super.dispose();
  }

  Future<void> search() async {
    status = '';
    setState(() => result = null);
    try {
      final profile = await widget.session.loadPublicProfile(handleController.text.trim());
      setState(() => result = profile);
    } catch (_) {
      setState(() => status = 'Profile not found.');
    }
  }

  Future<void> follow() async {
    if (result == null) {
      return;
    }

    try {
      await widget.session.follow(result!.id);
      setState(() => status = 'Followed.');
    } catch (_) {
      setState(() => status = 'Could not follow user.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        TextField(
          controller: handleController,
          decoration: const InputDecoration(labelText: 'Search handle', border: OutlineInputBorder()),
        ),
        const SizedBox(height: 10),
        ElevatedButton(onPressed: search, child: const Text('Search')),
        if (result != null)
          Card(
            child: ListTile(
              title: Text('${result!.displayName} (@${result!.handle})'),
              subtitle: Text(result!.bio),
              trailing: ElevatedButton(onPressed: follow, child: const Text('Follow')),
            ),
          ),
        if (status.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(status)),
      ],
    );
  }
}

class ProfileScreen extends StatefulWidget {
  final SessionController session;

  const ProfileScreen({super.key, required this.session});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final displayNameController = TextEditingController();
  final bioController = TextEditingController();
  String status = '';

  @override
  void initState() {
    super.initState();
    _syncFromSession();
  }

  void _syncFromSession() {
    final profile = widget.session.profile;
    if (profile != null) {
      displayNameController.text = profile.displayName;
      bioController.text = profile.bio;
    }
  }

  @override
  void dispose() {
    displayNameController.dispose();
    bioController.dispose();
    super.dispose();
  }

  Future<void> save() async {
    try {
      await widget.session.updateMyProfile(
        displayNameController.text.trim(),
        bioController.text.trim(),
      );
      setState(() => status = 'Saved.');
    } catch (_) {
      setState(() => status = 'Could not save profile.');
    }
  }

  Future<void> reload() async {
    try {
      await widget.session.refreshMe();
      _syncFromSession();
      setState(() => status = 'Reloaded.');
    } catch (_) {
      setState(() => status = 'Could not reload profile.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = widget.session.profile;

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        if (profile != null) ...[
          Text('@${profile.handle}', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 10),
          TextField(
            controller: displayNameController,
            decoration: const InputDecoration(labelText: 'Display Name', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: bioController,
            decoration: const InputDecoration(labelText: 'Bio', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 10,
            children: [
              ElevatedButton(onPressed: save, child: const Text('Save')),
              ElevatedButton(onPressed: reload, child: const Text('Reload')),
            ],
          ),
        ],
        if (status.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(status)),
      ],
    );
  }
}
