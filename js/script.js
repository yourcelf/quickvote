/*******************************
* Models
********************************/

/* Poll: A named question.  We just give it a slug here, but the choices we use
 * reference this.
    {
        name: "Poll Name",
        slug: "poll-name"
    }

*/
var app = {};

var PollModel = Backbone.Model.extend({
    initialize: function() {
        // Automatically create a "slug", a variant of the name suitable for
        // URLs, every time we set the name.
        this.on("change:name", function() {
            this.set("slug", this.get("name").toLowerCase().replace(/[^a-z]/g, '-'));
        }, this);
    },
    getURL: function() {
        // Return the URL to access this poll.  Note that if we used
        // "pushState=true", we'd want to replace the initial "#" with a "/".
        return "#poll/" + this.get("slug");
    },
    validate: function(attrs, options) {
        // Make sure that the name is set.  If we don't have a name when we try
        // to save, return a validation error.
        if (attrs.name == "") {
            return "Name can't be blank.";
        }
    }
});
var PollCollection = Backbone.Collection.extend({
    // A collection of polls.  Use it to construct the list of polls on the
    // front page.
    localStorage: new Backbone.LocalStorage("PollCollection"),
    model: PollModel
});

/* Choice: A single option for responding to a poll.

    {
        poll_id: 0,
        name: "Choice name",
        votes: 0
    }

*/
var ChoiceModel = Backbone.Model.extend({
    validate: function(attrs, options) {
        // Make sure that we have a name; through a validation error if not.
        if (attrs.name == "") {
            return "Choice can't be blank.";
        }
        // Make sure we have a poll_id. This needs to be set every time before
        // we save a new choice.
        if (!attrs.poll_id) {
            return "Need a poll ID!";
        }
    }
});
var ChoiceCollection = Backbone.Collection.extend({
    // A collection of choices.  Use it to display a list of choices within a
    // poll.
    localStorage: new Backbone.LocalStorage("ChoiceCollection"),
    model: ChoiceModel,
    initialize: function(models, options) {
        // When we initialize this collection, we set the ID for the current
        // poll.  That way, we can filter the choices to include only those
        // that belong to this poll.
        this.poll_id = options.poll_id;
    },
    parse: function(response, options) {
        // Filter the choices in the "parse" method.  If we were doing this as
        // a real application with network access, we'd want to have the server
        // filter the choices before sending them to us, probably by altering
        // the URL we use to access the choices.  But since we're using local 
        // storage, we just filter here. 
        return _.filter(response, _.bind(function(choiceJSON) {
            return choiceJSON.poll_id == this.poll_id;
        }, this));
    }
});

/*******************************
* Views
********************************/

var PollAddView = Backbone.View.extend({
    // A view for the front page, which lets us add polls, and navigate to
    // existing ones.
    template: _.template($("#pollAddViewTemplate").html()),
    events: {
        'submit form.add-poll': 'addPoll'
    },
    initialize: function(options) {
        this.polls = options.polls;
        // Re-render the page every time the list of polls changes.
        this.polls.on("change", this.render, this);
        // Grab the full list of polls.
        this.polls.fetch();
    },
    render: function() {
        this.$el.html(this.template({polls: this.polls}));
    },
    addPoll: function(event) {
        event.preventDefault();
        var name = this.$("[name=name]").val()
        name = $.trim(name);
        var poll = new PollModel();
        // This is a slightly tricky move here, caused by our use of
        // localStorage.  Since the poll only knows where to save itself by
        // virtue of the collection it's in, we need to associate it with the
        // collection before saving. But we also want to run validation before
        // saving.  So instead of just adding it to the collection, we set the
        // collection parameter (which doesn't add it), and then save.  If we
        // save successfully, we can add it to the collection.
        poll.collection = this.polls
        poll.set({name: name});
        // Show an error message if we have a validation error.
        poll.on("invalid", function() {
            this.$("input[name=name]").before(
                "<div class='error'>" + poll.validationError + "</div>"
            );
        }, this);
        // Save!
        poll.save({}, {
            success: _.bind(function() {
                // When we successfully save, add the poll to our collection,
                // and navigate to the poll immediately.
                this.polls.add(poll);
                router.navigate(poll.getURL(), {trigger: true});
            }, this),
            error: function() {
                // If something went wrong, don't add the poll.
                alert("something whent wrong!");
            }
        });
    }
});

var PollDetailView = Backbone.View.extend({
    // A view for showing a poll title, a list of choices, and a form to add
    // new choices.
    template: _.template($("#pollDetailViewTemplate").html()),
    initialize: function(options) {
        this.poll = options.poll;
        // Create a collection for the choices, initializing it with the ID for
        // our poll, so it can filter the choices to only include those in the
        // current poll.
        this.choices = new ChoiceCollection([], {poll_id: this.poll.id});
        // Every time a new choice is added, call call the function to add a
        // new choice view.
        this.choices.on("add", function(choice) {
            this.addChoiceView(choice);
        }, this);
        this.choices.fetch();
    },
    render: function() {
        this.$el.html(this.template({poll: this.poll}));
        
        // Add a choice view for each choice.
        this.choices.each(function(model) {
            this.addChoiceView(model);
        }, this);
        
        // Add a view with the form to add new choices
        this.choiceAddView = new ChoiceAddView();
        this.$(".choice-add").html(this.choiceAddView.el);
        this.choiceAddView.render();
        
        // Whenever the form reports that it got a new choice, try to add the
        // new choice model.  That function will handle validation errors.
        this.choiceAddView.on("gotNewChoice", this.addChoiceModel, this);

        // Add the view to show the list of the top choices.
        var topChoices = new TopChoicesView({choices: this.choices});
        this.$(".top-choices-view").html(topChoices.el);
        topChoices.render();
    },
    addChoiceModel: function(model) {
        // This function tries to add a new choice model, but makes sure that
        // it's valid first.

        // Check that there isn't an existing choice with the same name.
        var existing = this.choices.find(function(old) {
            return old.get("name") == model.get("name");
        });
        if (existing) {
            this.choiceAddView.setError("That name is already taken.");
            return;
        }

        // Set the poll_id of the choice, so that we can filter which poll to
        // display it in.
        model.set("poll_id", this.poll.id);
        
        // This is the same tricky move as above -- we set the collection so
        // that the model knows where to find local storage, but don't yet add
        // the model to the collection.
        model.collection = this.choices;

        // If we get a validation error, display it.
        model.on("invalid", function() {
            this.choiceAddView.setError(model.validationError);
            this.choices.remove(model);
        }, this);
        model.save({}, {
            success: _.bind(function() {
                this.choices.add(model);
            }, this)
        });
    },
    addChoiceView: function(model) {
        // Add a view that displays a single choice.
        var choiceView = new ChoiceDetailView({choice: model});
        this.$(".choices-list").append(choiceView.el);
        choiceView.render();
    }
});

var ChoiceAddView = Backbone.View.extend({
    // This is a subview used by PollDetailView to add choices with.  It just
    // shows a form, and listens for events on the form.
    template: _.template($("#choiceAddViewTemplate").html()),
    events: {
        'submit form.add-choice': 'addChoice'
    },
    render: function() {
        this.$el.html(this.template());
    },
    addChoice: function(event) {
        event.preventDefault();
        var name = this.$("[name=choice]").val();
        var choice = new ChoiceModel({name: name});
        // Render, which clears the form.
        this.render();
        // Trigger an event which indicates to the parent view that we have a
        // new choice.
        this.trigger("gotNewChoice", choice);
        // Just for classiness, focus the cursor in the choice field.
        this.$("input[name=choice]").select();
    },
    setError: function(message) {
        // The parent view can call this function to show an error message if
        // needed.
        this.$("input[name=choice]").before(
            "<div class='error'>" + message + "</div>"
        );
    }
});

var ChoiceDetailView = Backbone.View.extend({
    // This is simple view that just shows a choice.

    // Since we want to display this in a `ul` list, set the tagName to `li`
    // (it's `div` by default). That way, this.el will be an li tag.
    tagName: 'li',
    template: _.template($("#choiceDetailViewTemplate").html()),
    initialize: function(options) {
        this.choice = options.choice;
    },
    render: function() {
        this.$el.html(this.template({
            choice: this.choice
        }));
    }

});

var TopChoicesView = Backbone.View.extend({
    // This is a view that shows a list of the "top" choices so far, ordered by
    // votes.
    template: _.template($("#topChoicesViewTemplate").html()),
    initialize: function(options) {
        // This is the unsorted collection of choices.
        var choices = options.choices;
        // Create a new collection that is sorted by the number of votes.
        // Populate it with the models from the unsorted collection, and set up
        // a `comparator` that will make it always be sorted automatically.
        var sortedChoices = new ChoiceCollection(choices.models, {
            poll_id: choices.poll_id,
            comparator:  function(choice) {
                return -(choice.get("votes") || 0);
            }
        });
        // Every time the unsorted collection gets a new model, add one here too.
        choices.on("add", function(model) {
            sortedChoices.add(model);
        }, this);
        // Every time the unsorted collection loses a model, remove it here too.
        choices.on("remove", function(model) {
            sortedChoices.remove(model);
        }, this);
        // Every time the sorted collection changes (add, remove, or a change
        // to one of the member choices), re-render.
        sortedChoices.on("add remove change", this.render, this);
        this.sortedChoices = sortedChoices;
    },
    render: function() {
        this.$el.html(this.template({choices: this.sortedChoices}));
    }
});


/*******************************
* Router
********************************/

var Router = Backbone.Router.extend({
    routes: {
        "":           "pollAdd",
        "poll/:slug": "pollShow"
    },
    initialize: function() {
        // Create ourselves a new Poll collection, and keep it around for every
        // view to use.
        this.polls = new PollCollection();
        // Grab all the polls.
        this.polls.fetch();
    },
    pollAdd: function() {
        // Show the view to add new polls (the front page).
        var pollAddView = new PollAddView({polls: this.polls});
        // Add it to the dom...
        $("#app").html(pollAddView.el);
        // ... and draw it!
        pollAddView.render();
    },
    pollShow: function(slug) {
        // Show the detail view for a particular poll.  The 'slug' is a
        // property of the poll we want to show.  Search for the poll
        // that contains that slug.
        
        // Note that if we had to load the polls asynchronously (because
        // we were using ajax instead of localstorage, for example) we'd
        // have to be more careful to wait until we had the list of polls
        // before doing a find like this. We might prefer to find the poll by
        // doing a "fetch" on the single model, sending the slug as a URL
        // param.
        var poll = this.polls.find(function(poll) {
            return poll.get("slug") == slug;
        });
        if (!poll) {
            // oops -- didn't find a poll with that slug. Show a "not found"
            // error.
            return $("#app").html("Not found. <a href='#'>back</a>");
        }
        // Build the detail view, and add it to the DOM.
        var pollShowView = new PollDetailView({poll: poll});
        $("#app").html(pollShowView.el);
        pollShowView.render();
    }
});
var router = new Router();

// Take a gander at the URL and invoke the router.
Backbone.history.start()
