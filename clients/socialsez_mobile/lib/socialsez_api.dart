import 'dart:convert';

import 'package:http/http.dart' as http;

class AuthResponse {
  final String token;
  final String refreshToken;
  final DateTime expiresAtUtc;
  final ProfileDto profile;

  const AuthResponse({
    required this.token,
    required this.refreshToken,
    required this.expiresAtUtc,
    required this.profile,
  });

  factory AuthResponse.fromJson(Map<String, dynamic> json) {
    return AuthResponse(
      token: json['token'] as String,
      refreshToken: json['refreshToken'] as String,
      expiresAtUtc: DateTime.parse(json['expiresAtUtc'] as String),
      profile: ProfileDto.fromJson(json['profile'] as Map<String, dynamic>),
    );
  }
}

class ProfileDto {
  final String id;
  final String handle;
  final String displayName;
  final String bio;
  final bool isPrivate;

  const ProfileDto({
    required this.id,
    required this.handle,
    required this.displayName,
    required this.bio,
    required this.isPrivate,
  });

  factory ProfileDto.fromJson(Map<String, dynamic> json) {
    return ProfileDto(
      id: json['id'] as String,
      handle: json['handle'] as String,
      displayName: json['displayName'] as String,
      bio: json['bio'] as String? ?? '',
      isPrivate: json['isPrivate'] as bool? ?? false,
    );
  }
}

class UpdateProfileRequest {
  final String displayName;
  final String bio;

  const UpdateProfileRequest({required this.displayName, required this.bio});
}

class UpdateProfilePrivacyRequest {
  final bool isPrivate;

  const UpdateProfilePrivacyRequest({required this.isPrivate});
}

class PostDto {
  final String authorHandle;
  final String content;
  final String createdAtUtc;

  const PostDto({
    required this.authorHandle,
    required this.content,
    required this.createdAtUtc,
  });

  factory PostDto.fromJson(Map<String, dynamic> json) {
    return PostDto(
      authorHandle: json['authorHandle'] as String,
      content: json['content'] as String,
      createdAtUtc: json['createdAtUtc'] as String,
    );
  }
}

class FollowActionResult {
  final String status;

  const FollowActionResult({required this.status});

  factory FollowActionResult.fromJson(Map<String, dynamic> json) {
    return FollowActionResult(status: json['status'] as String? ?? 'Invalid');
  }
}

class FollowStatusDto {
  final bool isFollowing;
  final bool isRequested;
  final bool requiresApproval;

  const FollowStatusDto({
    required this.isFollowing,
    required this.isRequested,
    required this.requiresApproval,
  });

  factory FollowStatusDto.fromJson(Map<String, dynamic> json) {
    return FollowStatusDto(
      isFollowing: json['isFollowing'] as bool? ?? false,
      isRequested: json['isRequested'] as bool? ?? false,
      requiresApproval: json['requiresApproval'] as bool? ?? false,
    );
  }
}

class FollowRequestDto {
  final String followerId;
  final String followerHandle;
  final String status;
  final DateTime createdAtUtc;

  const FollowRequestDto({
    required this.followerId,
    required this.followerHandle,
    required this.status,
    required this.createdAtUtc,
  });

  factory FollowRequestDto.fromJson(Map<String, dynamic> json) {
    return FollowRequestDto(
      followerId: json['followerId'] as String,
      followerHandle: json['followerHandle'] as String? ?? '',
      status: json['status'] as String? ?? 'Pending',
      createdAtUtc: DateTime.tryParse(json['createdAtUtc'] as String? ?? '')?.toUtc() ?? DateTime.now().toUtc(),
    );
  }
}

class NotificationDto {
  final String id;
  final String message;
  final bool isRead;
  final DateTime createdAtUtc;

  const NotificationDto({
    required this.id,
    required this.message,
    required this.isRead,
    required this.createdAtUtc,
  });

  factory NotificationDto.fromJson(Map<String, dynamic> json) {
    return NotificationDto(
      id: json['id'] as String,
      message: json['message'] as String? ?? '',
      isRead: json['isRead'] as bool? ?? false,
      createdAtUtc: DateTime.tryParse(json['createdAtUtc'] as String? ?? '')?.toUtc() ?? DateTime.now().toUtc(),
    );
  }
}

class SocialSezApi {
  final String baseUrl;
  final String? token;
  final String? refreshToken;

  const SocialSezApi({this.baseUrl = 'http://10.0.2.2:5100/api', this.token, this.refreshToken});

  SocialSezApi withSession(String accessToken, String refreshTokenValue) =>
      SocialSezApi(baseUrl: baseUrl, token: accessToken, refreshToken: refreshTokenValue);

  Future<AuthResponse> register({
    required String email,
    required String password,
    required String handle,
    required String displayName,
    required String bio,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/register'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'email': email,
        'password': password,
        'handle': handle,
        'displayName': displayName,
        'bio': bio,
      }),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to register (${response.statusCode})');
    }

    return AuthResponse.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<AuthResponse> login({required String email, required String password}) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to login (${response.statusCode})');
    }

    return AuthResponse.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<AuthResponse> refresh() async {
    if (refreshToken == null || refreshToken!.isEmpty) {
      throw Exception('No refresh token available.');
    }

    final response = await http.post(
      Uri.parse('$baseUrl/auth/refresh'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'refreshToken': refreshToken}),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to refresh session (${response.statusCode})');
    }

    return AuthResponse.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> revoke() async {
    if (refreshToken == null || refreshToken!.isEmpty) {
      return;
    }

    await http.post(
      Uri.parse('$baseUrl/auth/revoke'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'refreshToken': refreshToken}),
    );
  }

  Future<ProfileDto> getProfile(String handle) async {
    final response = await http.get(Uri.parse('$baseUrl/profiles/$handle'));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Profile not found (${response.statusCode})');
    }

    return ProfileDto.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ProfileDto> getMe() async {
    final response = await http.get(
      Uri.parse('$baseUrl/profiles/me'),
      headers: _authHeaders(),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to load profile (${response.statusCode})');
    }

    return ProfileDto.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ProfileDto> updateMe(UpdateProfileRequest request) async {
    final response = await http.put(
      Uri.parse('$baseUrl/profiles/me'),
      headers: _authHeaders(),
      body: jsonEncode({
        'displayName': request.displayName,
        'bio': request.bio,
      }),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to update profile (${response.statusCode})');
    }

    return ProfileDto.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ProfileDto> updateMyPrivacy(UpdateProfilePrivacyRequest request) async {
    final response = await http.put(
      Uri.parse('$baseUrl/profiles/me/privacy'),
      headers: _authHeaders(),
      body: jsonEncode({
        'isPrivate': request.isPrivate,
      }),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to update privacy (${response.statusCode})');
    }

    return ProfileDto.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> createPost({required String content}) async {
    final response = await http.post(
      Uri.parse('$baseUrl/posts'),
      headers: _authHeaders(),
      body: jsonEncode({'content': content}),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to create post (${response.statusCode})');
    }
  }

  Future<List<PostDto>> getFeed({int take = 25}) async {
    final response = await http.get(
      Uri.parse('$baseUrl/posts/feed?take=$take'),
      headers: _authHeaders(),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to load feed (${response.statusCode})');
    }

    final list = jsonDecode(response.body) as List<dynamic>;
    return list.map((item) => PostDto.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<FollowActionResult> follow(String followedId) async {
    final response = await http.post(
      Uri.parse('$baseUrl/follows'),
      headers: _authHeaders(),
      body: jsonEncode({'followedId': followedId}),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to follow user (${response.statusCode})');
    }

    return FollowActionResult.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> unfollow(String followedId) async {
    final response = await http.delete(
      Uri.parse('$baseUrl/follows?followedId=$followedId'),
      headers: _authHeaders(),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to unfollow user (${response.statusCode})');
    }
  }

  Future<FollowStatusDto> getFollowStatus(String followedId) async {
    final response = await http.get(
      Uri.parse('$baseUrl/follows/status?followedId=$followedId'),
      headers: _authHeaders(),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to get follow status (${response.statusCode})');
    }

    return FollowStatusDto.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<List<FollowRequestDto>> getIncomingFollowRequests({int take = 50}) async {
    final response = await http.get(
      Uri.parse('$baseUrl/follows/requests/incoming?take=$take'),
      headers: _authHeaders(),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to load follow requests (${response.statusCode})');
    }

    final list = jsonDecode(response.body) as List<dynamic>;
    return list.map((item) => FollowRequestDto.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<void> approveFollowRequest(String followerId) async {
    final response = await http.post(
      Uri.parse('$baseUrl/follows/requests/$followerId/approve'),
      headers: _authHeaders(),
      body: jsonEncode({}),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to approve follow request (${response.statusCode})');
    }
  }

  Future<void> declineFollowRequest(String followerId) async {
    final response = await http.post(
      Uri.parse('$baseUrl/follows/requests/$followerId/decline'),
      headers: _authHeaders(),
      body: jsonEncode({}),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to decline follow request (${response.statusCode})');
    }
  }

  Future<List<NotificationDto>> getNotifications({int take = 50}) async {
    final response = await http.get(
      Uri.parse('$baseUrl/notifications?take=$take'),
      headers: _authHeaders(),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to load notifications (${response.statusCode})');
    }

    final list = jsonDecode(response.body) as List<dynamic>;
    return list.map((item) => NotificationDto.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<void> markNotificationRead(String notificationId) async {
    final response = await http.post(
      Uri.parse('$baseUrl/notifications/$notificationId/read'),
      headers: _authHeaders(),
      body: jsonEncode({}),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to mark notification read (${response.statusCode})');
    }
  }

  Future<int> markAllNotificationsRead() async {
    final response = await http.post(
      Uri.parse('$baseUrl/notifications/read-all'),
      headers: _authHeaders(),
      body: jsonEncode({}),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Failed to mark all notifications read (${response.statusCode})');
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return body['updatedCount'] as int? ?? 0;
  }

  Map<String, String> _authHeaders() {
    if (token == null || token!.isEmpty) {
      throw Exception('Missing auth token. Login first.');
    }

    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };
  }
}
